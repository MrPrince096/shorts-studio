# Shorts Studio — MCP server (drive it from an AI assistant)

This turns Shorts Studio into an **AI-assistant tool**: Claude Desktop, Cursor,
Claude Code, or any MCP client can create videos and run the autopilot in plain
language — *"make 3 shorts about deep-sea creatures"*, *"start a Japanese
comparison video"*, *"turn autopilot on with the niche 'stoic wisdom' daily"*.

It has **no dependencies** and talks to the **running Shorts Studio app** over
its local HTTP API, so:

1. Start Shorts Studio first (open the app, or `npm start`) — it listens on
   `http://localhost:4321`.
2. Register this MCP server with your AI client (below).

## Tools

`suggest_topic` · `create_short` · `create_story` · `create_comparison` ·
`get_job_status` · `list_videos` · `autopilot_status` · `autopilot_configure` ·
`autopilot_run_now`

## Add it to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "shorts-studio": {
      "command": "node",
      "args": ["/Users/praneethguptha/Youtube/shorts-engine/mcp/shorts-studio-mcp.mjs"],
      "env": { "SHORTS_URL": "http://localhost:4321" }
    }
  }
}
```

Restart Claude Desktop. You'll see the Shorts Studio tools available.

## Add it to Claude Code

```bash
claude mcp add shorts-studio -- node /Users/praneethguptha/Youtube/shorts-engine/mcp/shorts-studio-mcp.mjs
```

## Add it to Cursor

`~/.cursor/mcp.json` (same shape as the Claude Desktop block above).

## Notes

- The app must be running; if it isn't, the tools return a clear "can't reach
  Shorts Studio" message.
- `create_*` tools block until the render finishes (a few minutes) or time out
  and hand back a `jobId` — check it later with `get_job_status`.
- `SHORTS_URL` overrides the target (e.g. a different port).
- The server logs to stderr only; stdout is reserved for the MCP protocol.
