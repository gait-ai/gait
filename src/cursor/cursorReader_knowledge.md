# CursorReader Knowledge

This document provides a detailed mechanical description of the `cursorReader.ts` file, which is part of an extension for VSCode that interacts with Cursor AI.

## File Structure

The file imports necessary modules and defines a `SCHEMA_VERSION` constant.

## Key Interfaces and Types

- `CursorInlines`: Represents an interactive session with `text` and `commandType` properties.

## Main Class: CursorReader

The `CursorReader` class implements the `StateReader` interface and is responsible for reading and processing Cursor AI interactions.

### Properties

- `context`: VSCode extension context
- `inlineChats`: Array of `CursorInlines` or null
- `inlineStartInfo`: Inline chat start information or null
- `timedFileDiffs`: Array of `TimedFileDiffs`
- `fileDiffCutoff`: Number representing the cutoff time for file diffs (default: 60000ms)

### Methods

1. `pushFileDiffs`: Adds new file diffs to the `timedFileDiffs` array.

2. `matchPromptsToDiff`: 
   - Retrieves new inline chats
   - Matches them with file diffs
   - Creates `InlineChatInfo` objects
   - Writes inline chat information
   - Returns boolean indicating if new chats were added

3. `startInline`: Initializes the extension by reading interactive sessions.

4. `parseContext`: Private method that parses context from user messages, including selections, file selections, folder selections, and selected docs.

5. `parsePanelChatAsync`: 
   - Reads chat data from VSCode state
   - Parses it into `PanelChat` objects
   - Groups chat bubbles into pairs (user message and AI response)
   - Creates `MessageEntry` objects for each pair
   - Returns an array of non-empty `PanelChat` objects

## Helper Functions

1. `getSingleNewEditorText`: Compares old and new sessions to find new elements.

2. `getDBPath`: Retrieves the path to the VSCode state database.

## Key Workflows

1. Inline Chat Recording:
   - The extension monitors for new inline chats
   - When detected, it matches them with recent file diffs
   - It then creates and writes `InlineChatInfo` objects

2. Panel Chat Parsing:
   - The extension reads the VSCode state to get chat data
   - It processes this data into structured `PanelChat` objects
   - Each `PanelChat` contains `MessageEntry` objects representing the conversation

3. Context Parsing:
   - The extension extracts context from user messages
   - This includes selections, file selections, folder selections, and selected docs
   - The context is stored with each message entry

## Error Handling

The code includes error handling for scenarios such as:
- Missing workspace folder or storage URI
- Invalid internal chat data structure
- Failures in parsing panel chat data

## Telemetry

The code uses `posthog` to capture events like:
- Cursor inline chat
- Cursor composer chat
- Invalid internal chat data structure

## Files that use CursorReader

1. src/extension.ts:
   - Imports the CursorReader module
   - Uses it to create a StateReader based on whether the IDE is Cursor or VSCode
   - This occurs in the `activate` function of the extension

No other files in the provided codebase directly use the CursorReader.


## Usage of StateReader

The StateReader interface is implemented by both CursorReader and VSCodeReader classes. It's used in several parts of the application:

1. In src/extension.ts:
   - The StateReader is created based on whether the IDE is Cursor or VSCode.
   - It's used in the `triggerAccept` function to push file diffs and metadata.

2. In src/panelChats.ts:
   - The `monitorPanelChatAsync` function uses StateReader to parse panel chats asynchronously.


3. The StateReader interface (defined in src/types.ts) includes four main methods:
   - `startInline`: Initializes the extension by reading interactive sessions.
   - `pushFileDiffs`: Processes the editor content during inline chat acceptance.
   - `matchPromptsToDiff`: Processes the editor content during inline chat acceptance.
   - `parsePanelChatAsync`: Parses the panel chat from interactive sessions and assigns UUIDs based on existing order.


4. Both CursorReader and VSCodeReader implement these methods, but with different implementations based on the specific IDE they're designed for.

5. The StateReader is crucial for the extension's functionality as it provides an abstraction layer for reading and processing chat data, regardless of whether the user is using Cursor or VSCode.


## Aditional Context

- Cursor just released a new update to store composerChats (commandType 4) in a new key in state.vscdbd. This is the format of state.vscdb[composer.composerData]
- Note that not everyone might have access to this change yet, so the logic should account for that.

{"allComposers":[{"composerId":"a30e03af-9c22-4476-a876-dfa8c832efdc","richText":"{\"root\":{\"children\":[{\"children\":[],\"direction\":null,\"format\":\"\",\"indent\":0,\"type\":\"paragraph\",\"version\":1}],\"direction\":null,\"format\":\"\",\"indent\":0,\"type\":\"root\",\"version\":1}}","text":"","conversation":[{"type":1,"bubbleId":"5ab64847-52ae-4f91-9208-e6b6e4a43714","relevantFiles":["src/client.js"],"richText":"{\"root\":{\"children\":[{\"children\":[],\"direction\":null,\"format\":\"\",\"indent\":0,\"type\":\"paragraph\",\"version\":1}],\"direction\":null,\"format\":\"\",\"indent\":0,\"type\":\"root\",\"version\":1}}","text":"","context":{"notepads":[],"selections":[],"fileSelections":[{"uri":{"$mid":1,"fsPath":"/Users/alex/Documents/GitHub/mock/src/client.js","external":"file:///Users/alex/Documents/GitHub/mock/src/client.js","path":"/Users/alex/Documents/GitHub/mock/src/client.js","scheme":"file"},"addedWithoutMention":true}],"folderSelections":[],"selectedDocs":[],"selectedCommits":[],"selectedPullRequests":[],"terminalSelections":[],"terminalFiles":[],"quotes":[],"externalLinks":[],"selectedImages":[],"mentions":{"notepads":{},"selections":{},"fileSelections":{},"folderSelections":{},"selectedDocs":{},"selectedCommits":{},"selectedPullRequests":{},"terminalSelections":{},"terminalFiles":{},"quotes":{},"externalLinks":{},"selectedImages":{},"gitDiff":[],"gitDiffFromBranchToMain":[],"usesCodebase":[],"useWeb":[]}},"capabilityTypes":[],"isCapabilityIteration":false,"capabilityStatuses":{"mutate-request":[],"before-ai-bubble":[],"should-loop":[]}},{"type":2,"bubbleId":"ef53f335-606a-4514-abc4-e7da29c8690d","relevantFiles":[],"codeBlocks":[{"uri":{"$mid":1,"fsPath":"/Users/alex/Documents/GitHub/mock/src/client.js","external":"file:///Users/alex/Documents/GitHub/mock/src/client.js","path":"/Users/alex/Documents/GitHub/mock/src/client.js","scheme":"file"},"version":0,"codeBlockIdx":0}],"text":"Certainly! I'll remove the logging from the client code in the `src/client.js` file. Here are the changes:\n\n```javascript:src/client.js\nconst axios = require('axios');\n\nconst API_URL = 'http://localhost:3000';\n\nasync function register(username, email, password) {\n  try {\n    const response = await axios.post(`${API_URL}/register`, { username, email, password });\n    return response.data;\n  } catch (error) {\n    throw error;\n  }\n}\n\nasync function login(username, password) {\n  try {\n    const response = await axios.post(`${API_URL}/login`, { username, password });\n    return response.data.token;\n  } catch (error) {\n    throw error;\n  }\n}\n\nasync function accessProtectedRoute(token) {\n  try {\n    const response = await axios.get(`${API_URL}/protected`, {\n      headers: { Authorization: `Bearer ${token}` }\n    });\n    return response.data;\n  } catch (error) {\n    throw error;\n  }\n}\n\n// Example usage\nasync function main() {\n  try {\n    await register('testuser', 'test@example.com', 'Password123');\n    const token = await login('testuser', 'Password123');\n    await accessProtectedRoute(token);\n  } catch (error) {\n    console.error('An error occurred:', error.message);\n  }\n}\n\nmain();\n```\n\nIn this updated version:\n\n1. I've removed all `console.log` statements from the `register`, `login`, and `accessProtectedRoute` functions.\n2. I've also removed the `console.error` statements within these functions, as they were primarily used for logging errors.\n3. The basic error handling structure is maintained, but now it simply throws the error without logging it.\n4. The `main` function still has a `console.error` statement to log any errors that occur during the example usage. This is kept to provide some feedback in case of errors during the main execution.\n\nThese changes will remove all client-side logging except for the final error catch in the `main` function. If you want to remove server-side logging as well, you'll need to make similar changes to your server code, which isn't visible in the provided files."},{"type":1,"bubbleId":"d11d9bcb-d16a-4864-9f48-50021c747415","relevantFiles":["src/server.js","src/client.js"],"richText":"{\"root\":{\"children\":[{\"children\":[{\"detail\":0,\"format\":0,\"mode\":\"normal\",\"style\":\"\",\"text\":\"Do it for server as well\",\"type\":\"text\",\"version\":1}],\"direction\":\"ltr\",\"format\":\"\",\"indent\":0,\"type\":\"paragraph\",\"version\":1}],\"direction\":\"ltr\",\"format\":\"\",\"indent\":0,\"type\":\"root\",\"version\":1}}","text":"Do it for server as well","context":{"notepads":[],"selections":[],"fileSelections":[{"uri":{"$mid":1,"fsPath":"/Users/alex/Documents/GitHub/mock/src/client.js","external":"file:///Users/alex/Documents/GitHub/mock/src/client.js","path":"/Users/alex/Documents/GitHub/mock/src/client.js","scheme":"file"},"addedWithoutMention":true}],"folderSelections":[],"selectedDocs":[],"selectedCommits":[],"selectedPullRequests":[],"terminalSelections":[],"terminalFiles":[],"quotes":[],"externalLinks":[],"selectedImages":[],"mentions":{"notepads":{},"selections":{},"fileSelections":{},"folderSelections":{},"selectedDocs":{},"selectedCommits":{},"selectedPullRequests":{},"terminalSelections":{},"terminalFiles":{},"quotes":{},"externalLinks":{},"selectedImages":{},"gitDiff":[],"gitDiffFromBranchToMain":[],"usesCodebase":[],"useWeb":[]}},"capabilityTypes":[],"isCapabilityIteration":false,"capabilityStatuses":{"mutate-request":[],"before-ai-bubble":[],"should-loop":[]}},{"type":2,"bubbleId":"c135f907-8263-4dba-87c3-4c34bcdeaa23","relevantFiles":[],"codeBlocks":[{"uri":{"$mid":1,"fsPath":"/Users/alex/Documents/GitHub/mock/src/server.js","external":"file:///Users/alex/Documents/GitHub/mock/src/server.js","path":"/Users/alex/Documents/GitHub/mock/src/server.js","scheme":"file"},"version":0,"codeBlockIdx":0}],"text":"Certainly! I'll remove the logging from the server code in the `src/server.js` file. Here are the changes:\n\n```javascript:src/server.js\nconst express = require('express');\nconst jwt = require('jsonwebtoken');\nconst bcrypt = require('bcrypt');\nconst bodyParser = require('body-parser');\n\nconst app = express();\napp.use(bodyParser.json());\n\nconst users = [];\nconst SECRET_KEY = 'your-secret-key';\n\napp.post('/register', async (req, res) => {\n  const { username, email, password } = req.body;\n  \n  const existingUser = users.find(user => user.username === username || user.email === email);\n  if (existingUser) {\n    return res.status(400).json({ message: 'Username or email already exists' });\n  }\n\n  const hashedPassword = await bcrypt.hash(password, 10);\n  const newUser = { username, email, password: hashedPassword };\n  users.push(newUser);\n\n  res.status(201).json({ message: 'User registered successfully' });\n});\n\napp.post('/login', async (req, res) => {\n  const { username, password } = req.body;\n  \n  const user = users.find(user => user.username === username);\n  if (!user) {\n    return res.status(401).json({ message: 'Authentication failed' });\n  }\n\n  const isPasswordValid = await bcrypt.compare(password, user.password);\n  if (!isPasswordValid) {\n    return res.status(401).json({ message: 'Authentication failed' });\n  }\n\n  const token = jwt.sign({ username: user.username }, SECRET_KEY, { expiresIn: '1h' });\n  res.json({ token });\n});\n\nfunction authenticateToken(req, res, next) {\n  const authHeader = req.headers['authorization'];\n  const token = authHeader && authHeader.split(' ')[1];\n\n  if (!token) {\n    return res.status(401).json({ message: 'Authentication token required' });\n  }\n\n  jwt.verify(token, SECRET_KEY, (err, user) => {\n    if (err) {\n      return res.status(403).json({ message: 'Invalid or expired token' });\n    }\n    req.user = user;\n    next();\n  });\n}\n\napp.get('/protected', authenticateToken, (req, res) => {\n  res.json({ message: 'Access granted to protected route', user: req.user });\n});\n\nconst PORT = 3000;\napp.listen(PORT, () => {\n  console.log(`Server is running on port ${PORT}`);\n});\n```\n\nIn this updated version of `src/server.js`:\n\n1. I've removed all `console.log` statements from the route handlers and middleware functions.\n2. The basic error handling structure is maintained, but now it simply sends appropriate HTTP status codes and error messages without logging them.\n3. The only `console.log` statement that remains is in the `app.listen` callback, which logs that the server is running. This is often kept for operational purposes, but you can remove it if you want to eliminate all logging.\n\nThese changes will remove all server-side logging except for the server start message. The server will still send appropriate responses to the client, but it won't log any information about incoming requests or operations.\n\nIf you want to remove the last remaining `console.log` statement as well, you can modify the `app.listen` call like this:\n\n```javascript\nconst PORT = 3000;\napp.listen(PORT);\n```\n\nThis will start the server without any logging. However, keep in mind that having at least this one log can be helpful for confirming that the server has started successfully."}],"status":"completed","context":{"notepads":[],"selections":[],"fileSelections":[{"uri":{"$mid":1,"fsPath":"/Users/alex/Documents/GitHub/mock/src/client.js","external":"file:///Users/alex/Documents/GitHub/mock/src/client.js","path":"/Users/alex/Documents/GitHub/mock/src/client.js","scheme":"file"},"addedWithoutMention":true}],"folderSelections":[],"selectedDocs":[],"selectedCommits":[],"selectedPullRequests":[],"terminalSelections":[],"terminalFiles":[],"quotes":[],"externalLinks":[],"selectedImages":[],"mentions":{"notepads":{},"selections":{},"fileSelections":{},"folderSelections":{},"selectedDocs":{},"selectedCommits":{},"selectedPullRequests":{},"terminalSelections":{},"terminalFiles":{},"quotes":{},"externalLinks":{},"selectedImages":{},"gitDiff":[],"gitDiffFromBranchToMain":[],"usesCodebase":[],"useWeb":[]}},"gitGraphFileSuggestions":[],"userResponsesToSuggestedCodeBlocks":[{"userResponseType":1,"filePath":"src/server.js"}],"inlineDiffIdMap":{},"deleteFileSuggestions":[],"queuedAddedFiles":[],"generatingBubbleIds":[],"isReadingLongFile":false,"codeBlockData":{"file:///Users/alex/Documents/GitHub/mock/src/client.js":[{"uri":{"$mid":1,"fsPath":"/Users/alex/Documents/GitHub/mock/src/client.js","external":"file:///Users/alex/Documents/GitHub/mock/src/client.js","path":"/Users/alex/Documents/GitHub/mock/src/client.js","scheme":"file"},"version":0,"content":"const axios = require('axios');\n\nconst API_URL = 'http://localhost:3000';\n\nasync function register(username, email, password) {\n  try {\n    const response = await axios.post(`${API_URL}/register`, { username, email, password });\n    return response.data;\n  } catch (error) {\n    throw error;\n  }\n}\n\nasync function login(username, password) {\n  try {\n    const response = await axios.post(`${API_URL}/login`, { username, password });\n    return response.data.token;\n  } catch (error) {\n    throw error;\n  }\n}\n\nasync function accessProtectedRoute(token) {\n  try {\n    const response = await axios.get(`${API_URL}/protected`, {\n      headers: { Authorization: `Bearer ${token}` }\n    });\n    return response.data;\n  } catch (error) {\n    throw error;\n  }\n}\n\n// Example usage\nasync function main() {\n  try {\n    await register('testuser', 'test@example.com', 'Password123');\n    const token = await login('testuser', 'Password123');\n    await accessProtectedRoute(token);\n  } catch (error) {\n    console.error('An error occurred:', error.message);\n  }\n}\n\nmain();","languageId":"javascript","status":"accepted"}],"file:///Users/alex/Documents/GitHub/mock/src/server.js":[{"uri":{"$mid":1,"fsPath":"/Users/alex/Documents/GitHub/mock/src/server.js","external":"file:///Users/alex/Documents/GitHub/mock/src/server.js","path":"/Users/alex/Documents/GitHub/mock/src/server.js","scheme":"file"},"version":0,"content":"const express = require('express');\nconst jwt = require('jsonwebtoken');\nconst bcrypt = require('bcrypt');\nconst bodyParser = require('body-parser');\n\nconst app = express();\napp.use(bodyParser.json());\n\nconst users = [];\nconst SECRET_KEY = 'your-secret-key';\n\napp.post('/register', async (req, res) => {\n  const { username, email, password } = req.body;\n  \n  const existingUser = users.find(user => user.username === username || user.email === email);\n  if (existingUser) {\n    return res.status(400).json({ message: 'Username or email already exists' });\n  }\n\n  const hashedPassword = await bcrypt.hash(password, 10);\n  const newUser = { username, email, password: hashedPassword };\n  users.push(newUser);\n\n  res.status(201).json({ message: 'User registered successfully' });\n});\n\napp.post('/login', async (req, res) => {\n  const { username, password } = req.body;\n  \n  const user = users.find(user => user.username === username);\n  if (!user) {\n    return res.status(401).json({ message: 'Authentication failed' });\n  }\n\n  const isPasswordValid = await bcrypt.compare(password, user.password);\n  if (!isPasswordValid) {\n    return res.status(401).json({ message: 'Authentication failed' });\n  }\n\n  const token = jwt.sign({ username: user.username }, SECRET_KEY, { expiresIn: '1h' });\n  res.json({ token });\n});\n\nfunction authenticateToken(req, res, next) {\n  const authHeader = req.headers['authorization'];\n  const token = authHeader && authHeader.split(' ')[1];\n\n  if (!token) {\n    return res.status(401).json({ message: 'Authentication token required' });\n  }\n\n  jwt.verify(token, SECRET_KEY, (err, user) => {\n    if (err) {\n      return res.status(403).json({ message: 'Invalid or expired token' });\n    }\n    req.user = user;\n    next();\n  });\n}\n\napp.get('/protected', authenticateToken, (req, res) => {\n  res.json({ message: 'Access granted to protected route', user: req.user });\n});\n\nconst PORT = 3000;\napp.listen(PORT, () => {\n  console.log(`Server is running on port ${PORT}`);\n});","languageId":"javascript","status":"accepted"}]},"newlyCreatedFiles":[],"newlyCreatedFolders":[],"tabs":[{"type":"composer"},{"type":"code","uri":{"$mid":1,"fsPath":"/Users/alex/Documents/GitHub/mock/src/server.js","external":"file:///Users/alex/Documents/GitHub/mock/src/server.js","path":"/Users/alex/Documents/GitHub/mock/src/server.js","scheme":"file"},"version":0},{"type":"code","uri":{"$mid":1,"fsPath":"/Users/alex/Documents/GitHub/mock/src/client.js","external":"file:///Users/alex/Documents/GitHub/mock/src/client.js","path":"/Users/alex/Documents/GitHub/mock/src/client.js","scheme":"file"},"version":0}],"selectedTabIndex":0,"lastUpdatedAt":1729209134605,"createdAt":1729208967968,"hasChangedContext":true,"capabilities":[],"name":"Remove logging from client and server"}],"selectedComposerId":"a30e03af-9c22-4476-a876-dfa8c832efdc","composerDataVersion":0}

## Changes to make

- If the key composer.composerData exists, do the following:
    - Don't add composer chats to the inlines array, instead add them to the panelChats array
- Otherwise, maintain the old behaviour
    - Note that this means that the current logic will need to be maintained, for users who haven't updated yet

## Plan

Based on the provided `cursorReader_knowledge.md` and the outlined changes, here are my inferred answers to the questions posed:

1. **Location of `composer.composerData` Key Check:**
   
   - **Answer:** The verification of the `composer.composerData` key should occur **during the initialization** of the `CursorReader` class. Specifically, this check can be implemented within the constructor or an initialization method that is invoked when an instance of `CursorReader` is created. This ensures that the presence of `composer.composerData` is determined early, allowing the class to adjust its behavior accordingly from the outset.

2. **Handling of Composer Chats:**
   
   - **Answer:** Currently, composer chats are added to the `inlineChats` array within the `CursorReader` class. To accommodate the new requirement:
     - **If `composer.composerData` exists:** Composer chats should be **excluded from the `inlineChats` array** and instead **added to the `panelChats` array**.
     - **Else:** Continue adding composer chats to the `inlineChats` array as per the existing workflow.
   
   This modification ensures that composer chats are appropriately categorized based on the presence of `composer.composerData`.

3. **Structure and Usage of `panelChats` Array:**
   
   - **Answer:** The `panelChats` array is utilized to store `PanelChat` objects, which represent structured conversations comprising `MessageEntry` pairs (user message and AI response). Within the `CursorReader` class, methods like `parsePanelChatAsync` handle the creation and management of `PanelChat` instances. To integrate composer chats into `panelChats`:
     - **Composition:** Ensure that composer chats are formatted as `PanelChat` objects.
     - **Integration:** Update relevant methods to push composer chats into the `panelChats` array instead of `inlineChats` when `composer.composerData` is present.
   
   This approach maintains consistency in how panel chats are managed and utilized across the extension.

4. **Backward Compatibility Considerations:**
   
   - **Answer:** To maintain backward compatibility for users who haven't updated yet:
     - **Conditional Logic:** Implement conditional checks based on the existence of `composer.composerData`. If the key does not exist, retain the existing behavior of adding composer chats to `inlineChats`.
     - **Isolation of Changes:** Ensure that modifications to handle `panelChats` do not interfere with the `inlineChats` workflow. This can be achieved by segregating the new logic within separate methods or conditional branches.
     - **Testing:** Thoroughly test both scenarios (with and without `composer.composerData`) to confirm that existing functionalities remain unaffected for users without the update.
   
   These measures ensure a seamless experience for all users, regardless of their update status.
