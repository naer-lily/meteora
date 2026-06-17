import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, _ctx) => {
		const active = pi.getActiveTools();
		const defaults = new Set([...active, "grep", "find", "ls"]);
		pi.setActiveTools([...defaults]);
	});
}
