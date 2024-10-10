# gait

Welcome to gait, your intelligent companion for storing and sharing codegen prompts and conversations in VS Code or Cursor!

## Usage

### gait Automatically Records Cursor + Copilot Chats

No work on your end. There might be some delay! 

### gait blame: Viewing Chats

![Hover Demo](resources/hoverdemo3.gif)

Hover over AI-generated code to see the prompt that led to that particular code snippet. **Prompts are like automatic documentation.** 

### Stage, Unstage, and Delete Chats
<img src="resources/paneldemo.gif" alt="Panel Demo" width="400"/>

1. Open the gait side view by clicking on the gait icon in the Activity Bar.
2. Use the Panel View to stage or unstage chats - **treat chats like diffs**.
3. **IMPORTANT**: when you commit, 

```
> git add .gait/
```


### Toggling Annotations (Hover and Highlight)

Use the keyboard shortcut `Cmd+Shift+G` to toggle full color highlights on and off.

### Continuing a Chat

1. Select a previous chat from the Panel View.
2. Click the "resume" button to continue the chat.
3. Gait will provide all necessary context, including prompts and context files, in a markdown file.


## Features

1. **Automatic Chat Capture**: Gait automatically captures your inline chats and panel chats.
2. **Chat Management**: Manage panel chats in the UI - stage and unstage them like files in a commit.
3. **AI-Blame**: Hover over AI-generated code to view the prompt that led to that commit.
4. **Decoration Toggle**: Easily toggle decorations (hover and highlights) with a keyboard shortcut.
5. **Continuous Chat**: Pick up where you or your coworker left off by continuing the chat.

## Support

If you encounter any issues or have questions, text me or call me at 408-680-6718 or email founders@getgait.com

Happy coding with gait!
## Requirements

- Visual Studio Code 1.13.0 or higher
- GitHub Copilot Chat extension installed and configured

OR 

- Cursor

## Known Issues

Please report any issues to us directly - 408-680-6718. Or founders@getgait.com

## Release Notes

### 0.0.1
- Initial release of gait

**Enjoy using gait to enhance your coding experience!**
