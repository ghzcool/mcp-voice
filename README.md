# mcp-voice
A Model Context Protocol (MCP) server that gives LLMs the ability to "speak" by converting text to speech (TTS) and playing it aloud on your local machine.

{
  "mcpServers": {
    "mcp-voice": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-voice/index.js"],
      "env": {
        "TTS_MODE": "sapi",
        "GOOGLE_API_KEY": ""
      }
    }
  }
}
