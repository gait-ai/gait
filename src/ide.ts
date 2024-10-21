export type TOOL = "VSCode" | "Cursor" | "Unknown";

export function checkTool(): TOOL {
    const bundleIdentifier = process.env.__CFBundleIdentifier || "";
    const ipcHook = process.env.VSCODE_IPC_HOOK || "";
    const cwd = process.env.VSCODE_CWD || "";
  
    if (bundleIdentifier.includes("Cursor") || ipcHook.includes("Cursor") || cwd.includes("cursor")) {
      return "Cursor";
    } 
    return "VSCode";
  }