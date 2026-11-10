// A dozen plain functions over Surge XT's engine, for the Discobot trial build (stage 0 of
// docs/SURGE_XT_PLAN.md). Nothing here is part of the app.
#include "SurgeSynthesizer.h"
#include "PatchFileHeaderStructs.h"
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <exception>
#include <emscripten/emscripten.h>

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

// What Surge's random number generators are seeded with in place of the clock (shim/trial_seed.h).
extern "C" unsigned surge_trial_next_seed(void)
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
