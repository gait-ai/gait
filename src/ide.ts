export type TOOL = "VSCode" | "Cursor" | "Unknown";

export function checkTool(): TOOL {
    const bundleIdentifier = process.env.__CFBundleIdentifier || "";
    const ipcHook = process.env.VSCODE_IPC_HOOK || "";
  
    if (bundleIdentifier.includes("Cursor") || ipcHook.includes("Cursor")) {
      return "Cursor";
    } 
    return "VSCode";
  }