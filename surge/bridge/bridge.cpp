// Plain functions over Surge XT's engine, for Discobot (docs/SURGE_XT_PLAN.md). Built by
// surge/build.sh into surge/dist/.
#include "SurgeSynthesizer.h"
#include "PatchFileHeaderStructs.h"
#include "sst/basic-blocks/mechanics/endian-ops.h"
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <climits>
#include <vector>
#include <memory>
#include <string>
#include <exception>
#include <emscripten/emscripten.h>

namespace mech = sst::basic_blocks::mechanics;

namespace
{
struct Quiet : public SurgeSynthesizer::PluginLayer
{
    void surgeParameterUpdated(const SurgeSynthesizer::ID &, float) override {}
    void surgeMacroUpdated(long, float) override {}
};

struct Engine
{
    Quiet layer;
    std::unique_ptr<SurgeSynthesizer> synth;
    int used{BLOCK_SIZE}; // samples of the current block already handed out
};

int readBE(const unsigned char *p) { return (p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]; }
std::string lastError;
const unsigned char *savedData = nullptr;

// Surge's effects and modulators ask the system for random numbers (std::random_device, which
// asks getentropy). Defining getentropy here answers them from a sequence the seed decides, so
// an export can repeat, and nothing asks the browser, which an audio worklet could not answer.
uint64_t entropyState = 0x9E3779B97F4A7C15ull;
uint32_t clockSeeds = 1;
void seedEntropy(unsigned seed)
{
    entropyState = 0x9E3779B97F4A7C15ull ^ ((uint64_t)seed << 32 | seed);
    clockSeeds = seed * 2654435761u + 1;
}
} // namespace

// What Surge's random number generators are seeded with in place of the clock (shim/discobot_seed.h).
extern "C" unsigned discobot_surge_next_seed(void)
{
    clockSeeds = clockSeeds * 1664525u + 1013904223u;
    return clockSeeds;
}

extern "C" int getentropy(void *buffer, size_t length)
{
    auto *bytes = static_cast<unsigned char *>(buffer);
    for (size_t i = 0; i < length; ++i)
    {
        entropyState ^= entropyState << 13;
        entropyState ^= entropyState >> 7;
        entropyState ^= entropyState << 17;
        bytes[i] = (unsigned char)(entropyState >> 24);
    }
    return 0;
}

extern "C"
{
    EMSCRIPTEN_KEEPALIVE int surge_block_size() { return BLOCK_SIZE; }

    // Surge seeds std::rand from the clock when it is made; this sets it again.
    EMSCRIPTEN_KEEPALIVE void surge_seed(unsigned seed)
    {
        std::srand(seed);
        seedEntropy(seed);
    }

    // What the last call that failed threw, if anything.
    EMSCRIPTEN_KEEPALIVE const char *surge_last_error() { return lastError.c_str(); }

    // Null when Surge could not be made; surge_last_error says why.
    EMSCRIPTEN_KEEPALIVE Engine *surge_create(float sampleRate, unsigned seed)
    {
        auto *engine = new Engine();
        seedEntropy(seed);
        try
        {
            engine->synth = std::make_unique<SurgeSynthesizer>(
                &engine->layer, SurgeStorage::skipPatchLoadDataPathSentinel);
            engine->synth->setSamplerate(sampleRate);
            engine->synth->time_data.tempo = 120;
            engine->synth->time_data.ppqPos = 0;
        }
        catch (const std::exception &e)
        {
            lastError = std::string("create: ") + e.what();
            delete engine;
            return nullptr;
        }
        catch (...)
        {
            lastError = "create: unknown exception";
            delete engine;
            return nullptr;
        }
        std::srand(seed);
        return engine;
    }

    EMSCRIPTEN_KEEPALIVE void surge_destroy(Engine *engine) { delete engine; }

    // A whole .fxp file. 0 when loaded; 1 when it is not a Surge patch; 2 when it is cut short.
    EMSCRIPTEN_KEEPALIVE int surge_load_fxp(Engine *engine, const unsigned char *data, int size)
    {
        if (size < (int)sizeof(sst::io::fxChunkSetCustom))
            return 2;
        if (readBE(data) != 'CcnK' || readBE(data + 8) != 'FPCh' || readBE(data + 16) != 'cjs3')
            return 1;
        int chunk = readBE(data + 56);
        if (chunk <= 0 || (int)sizeof(sst::io::fxChunkSetCustom) + chunk > size)
            return 2;
        auto &synth = *engine->synth;
        synth.allNotesOff();
        synth.storage.getPatch().comment = "";
        synth.storage.getPatch().author = "";
        try
        {
            synth.loadRaw(data + sizeof(sst::io::fxChunkSetCustom), chunk, false);
        }
        catch (const std::exception &e)
        {
            lastError = std::string("load: ") + e.what();
            return 3;
        }
        catch (...)
        {
            lastError = "load: unknown exception";
            return 3;
        }
        engine->used = BLOCK_SIZE;
        return 0;
    }

    EMSCRIPTEN_KEEPALIVE const char *surge_patch_name(Engine *engine)
    {
        return engine->synth->storage.getPatch().name.c_str();
    }

    EMSCRIPTEN_KEEPALIVE const char *surge_macro_name(Engine *engine, int index)
    {
        if (index < 0 || index >= n_customcontrollers)
            return "";
        return engine->synth->storage.getPatch().CustomControllerLabel[index];
    }

    EMSCRIPTEN_KEEPALIVE void surge_set_macro(Engine *engine, int index, float value)
    {
        if (index >= 0 && index < n_customcontrollers)
            engine->synth->setMacroParameter01(index, value);
    }

    EMSCRIPTEN_KEEPALIVE void surge_note_on(Engine *engine, int key, int velocity)
    {
        engine->synth->playNote(0, (char)key, (char)velocity, 0);
    }

    EMSCRIPTEN_KEEPALIVE void surge_note_off(Engine *engine, int key, int velocity)
    {
        engine->synth->releaseNote(0, (char)key, (char)velocity);
    }

    EMSCRIPTEN_KEEPALIVE void surge_all_notes_off(Engine *engine) { engine->synth->allNotesOff(); }

    // As a MIDI pitch wheel: -8192 to 8191, 0 at rest.
    EMSCRIPTEN_KEEPALIVE void surge_pitch_bend(Engine *engine, int value)
    {
        engine->synth->pitchBend(0, value < -8192 ? -8192 : value > 8191 ? 8191 : value);
    }

    // Writing patches (surge/patches/): Discobot's own Surge patches are made from the blank patch
    // by naming each parameter and the value Surge would show for it.

    EMSCRIPTEN_KEEPALIVE int surge_param_count(Engine *engine)
    {
        return (int)engine->synth->storage.getPatch().param_ptr.size();
    }

    // The name a parameter is saved under in a patch, such as "a_osc1_type".
    EMSCRIPTEN_KEEPALIVE const char *surge_param_name(Engine *engine, int index)
    {
        auto &params = engine->synth->storage.getPatch().param_ptr;
        return index >= 0 && index < (int)params.size() ? params[index]->get_storage_name() : "";
    }

    // What Surge shows for a parameter now, such as "Classic" or "440.00 Hz".
    EMSCRIPTEN_KEEPALIVE const char *surge_param_display(Engine *engine, int index)
    {
        static std::string shown;
        auto &params = engine->synth->storage.getPatch().param_ptr;
        shown = index >= 0 && index < (int)params.size() ? params[index]->get_display() : "";
        return shown.c_str();
    }

    // 0 when set; 1 when no parameter has that name; 2 when Surge cannot read the value
    // (surge_last_error says why). A whole-number parameter takes what Surge shows for one of
    // its values ("Sine") or the number itself; an on-off one takes "on" or "off". A change of
    // type (an oscillator's, a filter's) happens on the next block, so a patch sets types first,
    // renders a block, then sets the rest.
    EMSCRIPTEN_KEEPALIVE int surge_param_set(Engine *engine, const char *name, const char *text)
    {
        auto &synth = *engine->synth;
        auto &params = synth.storage.getPatch().param_ptr;
        int found = -1;
        for (int i = 0; i < (int)params.size(); ++i)
            if (std::strcmp(params[i]->get_storage_name(), name) == 0)
            {
                found = i;
                break;
            }
        if (found < 0)
            return 1;
        auto *p = params[found];
        std::string value(text);
        float normalized = 0;
        if (p->valtype == vt_float)
        {
            if (!synth.stringToNormalizedValue(synth.idForParameter(p), value, normalized))
            {
                lastError = std::string(name) + ": cannot read '" + value + "'";
                return 2;
            }
        }
        else if (p->valtype == vt_bool)
        {
            if (value != "on" && value != "off")
            {
                lastError = std::string(name) + ": on or off, not '" + value + "'";
                return 2;
            }
            normalized = value == "on" ? 1.f : 0.f;
        }
        else
        {
            int chosen = INT32_MIN;
            auto before = p->val;
            for (int k = p->val_min.i; k <= p->val_max.i && chosen == INT32_MIN; ++k)
            {
                p->val.i = k;
                if (p->get_display() == value)
                    chosen = k;
            }
            p->val = before;
            if (chosen == INT32_MIN)
            {
                char *end = nullptr;
                long number = std::strtol(value.c_str(), &end, 10);
                if (end && *end == 0 && !value.empty() && number >= p->val_min.i && number <= p->val_max.i)
                    chosen = (int)number;
            }
            if (chosen == INT32_MIN)
            {
                lastError = std::string(name) + ": no value '" + value + "'";
                return 2;
            }
            normalized = Parameter::intScaledToFloat(chosen, p->val_max.i, p->val_min.i);
        }
        synth.setParameter01(synth.idForParameter(p), normalized, false, p->valtype != vt_float);
        return 0;
    }

    // Lets macro `macro` (0 to 7) move a parameter; depth is from -1 to 1 of its whole range.
    // 0 when set; 1 when no parameter has that name; 2 when it cannot be modulated.
    EMSCRIPTEN_KEEPALIVE int surge_route_macro(Engine *engine, int macro, const char *name, float depth)
    {
        auto &synth = *engine->synth;
        if (macro < 0 || macro >= n_customcontrollers)
            return 2;
        auto &params = synth.storage.getPatch().param_ptr;
        for (int i = 0; i < (int)params.size(); ++i)
            if (std::strcmp(params[i]->get_storage_name(), name) == 0)
                return synth.setModDepth01(i, (modsources)(ms_ctrl1 + macro), 0, 0,
                                           depth * 0.5f + 0.5f)
                           ? 0
                           : 2;
        return 1;
    }

    EMSCRIPTEN_KEEPALIVE void surge_set_macro_name(Engine *engine, int macro, const char *name)
    {
        if (macro >= 0 && macro < n_customcontrollers)
        {
            auto &label = engine->synth->storage.getPatch().CustomControllerLabel[macro];
            std::strncpy(label, name, CUSTOM_CONTROLLER_LABEL_SIZE - 1);
            label[CUSTOM_CONTROLLER_LABEL_SIZE - 1] = 0;
        }
    }

    EMSCRIPTEN_KEEPALIVE void surge_set_patch_name(Engine *engine, const char *name)
    {
        engine->synth->storage.getPatch().name = name;
    }

    // The patch as a whole .fxp file, as Surge saves one; surge_saved_data is where it is.
    EMSCRIPTEN_KEEPALIVE int surge_save_fxp(Engine *engine)
    {
        static std::vector<unsigned char> saved;
        auto &patch = engine->synth->storage.getPatch();
        void *data = nullptr;
        unsigned int size = patch.save_patch(&data);
        sst::io::fxChunkSetCustom header{};
        header.chunkMagic = mech::endian_write_int32BE('CcnK');
        header.fxMagic = mech::endian_write_int32BE('FPCh');
        header.fxID = mech::endian_write_int32BE('cjs3');
        header.numPrograms = mech::endian_write_int32BE(1);
        header.version = mech::endian_write_int32BE(1);
        header.fxVersion = mech::endian_write_int32BE(1);
        std::strncpy(header.prgName, patch.name.c_str(), 27);
        header.chunkSize = mech::endian_write_int32BE(size);
        saved.resize(sizeof(header) + size);
        std::memcpy(saved.data(), &header, sizeof(header));
        std::memcpy(saved.data() + sizeof(header), data, size);
        savedData = saved.data();
        return (int)saved.size();
    }

    EMSCRIPTEN_KEEPALIVE const unsigned char *surge_saved_data() { return savedData; }

    // Fills left and right with the next frames, 32 samples at a time inside.
    EMSCRIPTEN_KEEPALIVE void surge_render(Engine *engine, float *left, float *right, int frames)
    {
        auto &synth = *engine->synth;
        for (int i = 0; i < frames; ++i)
        {
            if (engine->used == BLOCK_SIZE)
            {
                synth.process();
                engine->used = 0;
            }
            left[i] = synth.output[0][engine->used];
            right[i] = synth.output[1][engine->used];
            engine->used++;
        }
    }
}
