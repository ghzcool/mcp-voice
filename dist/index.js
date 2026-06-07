import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFileSync, unlinkSync } from "fs";
const execAsync = promisify(exec);
// Environment config
const TTS_MODE = process.env.TTS_MODE || "sapi"; // "sapi" | "google"
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const GOOGLE_VOICE = process.env.GOOGLE_VOICE || "en-US-Journey-Female";
//
// Windows SAPI text-to-speech
//
function containsCyrillic(text) {
    return /[\u0400-\u04FF]/.test(text);
}
async function speakSapi(text) {
    const encoded = Buffer.from(text.replace(/'/g, ""), "utf8").toString("base64");
    const voice = containsCyrillic(text) ? "Microsoft Irina Desktop" : "Microsoft Zira Desktop";
    const psScript = `
Add-Type -AssemblyName System.Speech

$bytes = [Convert]::FromBase64String('${encoded}')
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToDefaultAudioDevice()
$synth.SelectVoice('${voice}')
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$synth.Speak($text)
`;
    const tmpFile = `${process.env.TEMP}\\mcp-voice-${Date.now()}.ps1`;
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
//
// Google Cloud TTS text-to-speech
//
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
    const tmpPath = `${process.env.TEMP || process.env.TMP}/mcp-voice-${Date.now()}.wav`;
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
//
// MCP Server
//
const server = new Server({
    name: "mcp-voice",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "speak",
            description: `Converts text to speech and plays it aloud using the configured TTS engine.\n\n` +
                `Modes:\n` +
                `- sapi (default): Windows built-in SAPI speech synthesis, no setup needed\n` +
                `- google: Google Cloud Text-to-Speech API, requires GOOGLE_API_KEY env var\n\n` +
                `Use short phrases (1-2 sentences) for clear voice feedback.`,
            inputSchema: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description: "Text to speak. Keep it short (1 phrase) for quick voice feedback.",
                    },
                },
                required: ["text"],
            },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "speak") {
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const text = request.params.arguments?.text;
    if (!text || typeof text !== "string") {
        return {
            content: [{ type: "text", text: "Error: No text provided." }],
        };
    }
    try {
        if (TTS_MODE === "google") {
            await speakGoogle(text);
        }
        else {
            await speakSapi(text);
        }
        return {
            content: [
                {
                    type: "text",
                    text: `Spoken: "${text}" (mode: ${TTS_MODE})`,
                },
            ],
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [
                {
                    type: "text",
                    text: `Speech error: ${errorMessage}`,
                },
            ],
            isError: true,
        };
    }
});
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("mcp-voice server running on stdio (TTS mode: " + TTS_MODE + ")");
