// A dozen plain functions over Surge XT's engine, for the Discobot trial build (stage 0 of
// docs/SURGE_XT_PLAN.md). Nothing here is part of the app.
#include "SurgeSynthesizer.h"
#include "PatchFileHeaderStructs.h"
#include <cstdlib>
#include <cstring>
#include <memory>
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
} // namespace

extern "C"
{
    EMSCRIPTEN_KEEPALIVE int surge_block_size() { return BLOCK_SIZE; }

    // Surge seeds std::rand from the clock when it is made; this sets it again.
    EMSCRIPTEN_KEEPALIVE void surge_seed(unsigned seed) { std::srand(seed); }

    EMSCRIPTEN_KEEPALIVE Engine *surge_create(float sampleRate, unsigned seed)
    {
        auto *engine = new Engine();
        engine->synth = std::make_unique<SurgeSynthesizer>(
            &engine->layer, SurgeStorage::skipPatchLoadDataPathSentinel);
        engine->synth->setSamplerate(sampleRate);
        engine->synth->time_data.tempo = 120;
        engine->synth->time_data.ppqPos = 0;
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
        synth.loadRaw(data + sizeof(sst::io::fxChunkSetCustom), chunk, false);
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
