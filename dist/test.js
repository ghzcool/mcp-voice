import { exec } from "child_process";
import { promisify } from "util";
import { writeFileSync, unlinkSync } from "fs";
const execAsync = promisify(exec);
const TTS_MODE = process.env.TTS_MODE || "sapi";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const GOOGLE_VOICE = process.env.GOOGLE_VOICE || "en-US-Journey-Female";
const SAMPLES = [
    "Finished research, starting with implementation.",
    "This does not work this way, I will try another way.",
    "Found 3 relevant files.",
    "All tasks completed successfully.",
    "Encountered an error, retrying now.",
    "I need to search the codebase for this.",
    "Testing voice output with special chars: 123!@#",
];
async function speakSapi(text) {
    const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToDefaultAudioDevice()
$synth.Speak('${text.replace(/'/g, "''")}')
`;
    const tmpFile = `${process.env.TEMP}\\mcp-voice-test-${Date.now()}.ps1`;
    try {
        writeFileSync(tmpFile, psScript, "utf8");
        await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`);
    }
    finally {
        try {
            unlinkSync(tmpFile);
        }
        catch { }
    }
}
async function speakGoogle(text) {
    if (!GOOGLE_API_KEY) {
        throw new Error("GOOGLE_API_KEY is not set for Google TTS mode");
    }
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_API_KEY}`;
    const body = JSON.stringify({
        input: { text },
        voice: { languageCode: "en-US", name: GOOGLE_VOICE },
        audioConfig: { audioEncoding: "LINEAR16", samplingRateHertz: 24000 },
    });
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Google TTS API error: ${err}`);
    }
    const data = await response.json();
    const audioContent = data.audioContent;
    const tmpPath = `${process.env.TEMP || process.env.TMP}/mcp-voice-test-${Date.now()}.wav`;
    writeFileSync(tmpPath, Buffer.from(audioContent, "base64"));
    try {
        if (process.platform === "win32") {
            const psScript = `
$player = New-Object Media.SoundPlayer('${tmpPath.replace(/'/g, "''")}')
$player.PlaySync()
`;
            const psFile = `${process.env.TEMP}\\mcp-voice-play-${Date.now()}.ps1`;
            try {
                writeFileSync(psFile, psScript, "utf8");
                await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`);
            }
            finally {
                try {
                    unlinkSync(psFile);
                }
                catch { }
            }
        }
        else if (process.platform === "darwin") {
            await execAsync(`afplay '${tmpPath}'`);
        }
        else {
            await execAsync(`aplay -q '${tmpPath}'`);
        }
    }
    finally {
        try {
            unlinkSync(tmpPath);
        }
        catch { }
    }
}
async function main() {
    console.log(`\n[mcp-voice test] TTS mode: ${TTS_MODE}\n`);
    if (TTS_MODE === "google" && !GOOGLE_API_KEY) {
        console.error("[mcp-voice test] ERROR: GOOGLE_API_KEY is not set.\n");
        process.exit(1);
    }
    for (let i = 0; i < SAMPLES.length; i++) {
        const text = SAMPLES[i];
        console.log(`[${i + 1}/${SAMPLES.length}] Speaking: "${text}"`);
        try {
            if (TTS_MODE === "google") {
                await speakGoogle(text);
            }
            else {
                await speakSapi(text);
            }
            console.log(`      -> OK\n`);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`      -> FAILED: ${msg}\n`);
        }
        if (i < SAMPLES.length - 1) {
            await new Promise((r) => setTimeout(r, 300));
        }
    }
    console.log("[mcp-voice test] Done.\n");
}
main();
