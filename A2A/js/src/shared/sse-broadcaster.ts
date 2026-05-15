// ================= SSE BROADCASTER =================
// Shared module for broadcasting agent messages to UI via Server-Sent Events

import type { Request, Response } from "express";

// Global monotonic sequence — incremented on every broadcast across all agents
// For cross-process ordering, the seq is embedded in the SSE payload so the UI can sort by it
let globalSeq = 0;

export class SSEBroadcaster {
  private clients: Set<Response> = new Set();
  private agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  /** Register a new SSE client connection */
  addClient(req: Request, res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ text: `Connected to ${this.agentName} agent events`, timestamp: new Date().toISOString(), seq: 0 })}\n\n`);

    this.clients.add(res);
    req.on("close", () => { this.clients.delete(res); });
  }

  /** Broadcast a text message to all connected SSE clients */
  broadcast(text: string): void {
    if (this.clients.size === 0) return;
    const seq = ++globalSeq;
    const payload = `data: ${JSON.stringify({ text, timestamp: new Date().toISOString(), seq })}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }
}
