# Panel Chats

Panel Chat Title: Merging Gzip Files with Conflicts
- **Created On**: 2024-09-28T01:26:12.525Z
- **Messages**:
    - **Model**: claude-3.5-sonnet
    - **Context**: /Users/kylel1/Documents/GitHub/gait-copilot/src/automerge.ts
    - **Text**: if I want to merge two gzip files from a file with merge conflicts? how would I do it?
    - **Response**: To merge two gzip files from a file with merge conflicts, you'll need to modify the `resolveMergeConflicts` function and add a new function to handle gzip files. Here's how you can update your code to achieve this:

```typescript:src/automerge.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StashedState, isStashedState } from './types';
import * as zlib from 'zlib';

// ... existing code ...

async function resolveMergeConflicts(document: vscode.TextDocument) {
    const text = document.getText();
    const { version1, version2 } = extractConflictingVersions(text);

    if (version1 && version2) {
        let mergedContent: string | null = null;
        
        if (document.fileName.endsWith('stashedPanelChats.json.gz')) {
            mergedContent = await mergeGzipFiles(version1, version2);
        } else if (document.fileName.endsWith('stashedPanelChats.json')) {
            mergedContent = mergeStashedStates(version1, version2);
        }

        if (mergedContent) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), mergedContent);
            await vscode.workspace.applyEdit(edit);
            await document.save();
            vscode.window.showInformationMessage(`Merge conflicts in ${path.basename(document.fileName)} automatically resolved.`);
        }
    }
}

// ... existing code ...

async function mergeGzipFiles(version1: string, version2: string): Promise<string | null> {
    try {
        const gunzip = zlib.gunzipSync;
        const gzip = zlib.gzipSync;

        // Decompress both versions
        const decompressedVersion1 = gunzip(Buffer.from(version1, 'base64')).toString();
        const decompressedVersion2 = gunzip(Buffer.from(version2, 'base64')).toString();

        // Merge the decompressed JSON content
        const mergedContent = mergeStashedStates(decompressedVersion1, decompressedVersion2);

        if (mergedContent) {
            // Compress the merged content
            const compressedMergedContent = gzip(Buffer.from(mergedContent)).toString('base64');
            return compressedMergedContent;
        }

        return null;
    } catch (error) {
        console.error('Error merging gzip files:', error);
        return null;
    }
}

// ... rest of the existing code ...
```

Here's an explanation of the changes:

1. We've imported the `zlib` module to handle gzip compression and decompression.

2. In the `resolveMergeConflicts` function, we've added a condition to check if the file ends with `.json.gz`. If it does, we call the new `mergeGzipFiles` function instead of `mergeStashedStates`.

3. We've added a new `mergeGzipFiles` function that:
   - Decompresses both versions of the gzipped content using `zlib.gunzipSync`.
   - Calls the existing `mergeStashedStates` function with the decompressed content.
   - If the merge is successful, it compresses the merged content using `zlib.gzipSync`.
   - Returns the compressed merged content as a base64-encoded string.

4. We've assumed that the gzipped content in the merge conflict is base64-encoded. If it's not, you may need to adjust the encoding/decoding steps accordingly.

5. Error handling is in place to catch any issues during the gzip merging process.

This approach allows you to handle both regular JSON files and gzipped JSON files with merge conflicts. The merged content will be saved in the same format as the original file (gzipped for `.json.gz` files).

Remember to test this implementation thoroughly with your specific use case, as gzip handling can be tricky and may require additional error handling or adjustments based on your exact file format and content.
 - **Expanded Context** + Whole file in context:
 import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StashedState, isStashedState } from './types';

export async function handleMerge(context: vscode.ExtensionContext) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return;
    }

    const gaitFolder = path.join(workspaceFolder.uri.fsPath, '.gait');
    if (!fs.existsSync(gaitFolder)) {
        vscode.window.showInformationMessage('No .gait folder found. No merge conflicts to resolve.');
        return;
    }

    const files = fs.readdirSync(gaitFolder);
    for (const file of files) {
        if (path.extname(file) === '.json') {
            const filePath = path.join(gaitFolder, file);
            const document = await vscode.workspace.openTextDocument(filePath);
            const hasMergeConflicts = checkForMergeConflicts(document);
            if (hasMergeConflicts) {
                await resolveMergeConflicts(document);
            }
        }
    }
}

function checkForMergeConflicts(document: vscode.TextDocument): boolean {
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    return diagnostics.some(diagnostic => diagnostic.message.includes('Merge conflict'));
}

async function resolveMergeConflicts(document: vscode.TextDocument) {
    const text = document.getText();
    const { version1, version2 } = extractConflictingVersions(text);

    if (version1 && version2) {
        let mergedContent: string | null = null;
        
        if (document.fileName.endsWith('stashedPanelChats.json.gz')) {
            mergedContent = mergeStashedStates(version1, version2);
        } 
        if (mergedContent) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), mergedContent);
            await vscode.workspace.applyEdit(edit);
            await document.save();
            vscode.window.showInformationMessage(`Merge conflicts in ${path.basename(document.fileName)} automatically resolved.`);
        }
    }
}

function extractConflictingVersions(content: string): { version1: string, version2: string } {
    const version1Parts: string[] = [];
    const version2Parts: string[] = [];

    const lines = content.split('\n');
    let inVersion1 = false;
    let inVersion2 = false;

    for (let line of lines) {
        if (line.startsWith('<<<<<<<')) {
            // Start of the first version (Version 1)
            inVersion1 = true;
            inVersion2 = false;
        } else if (line.startsWith('=======')) {
            // Switch to the second version (Version 2)
            inVersion1 = false;
            inVersion2 = true;
        } else if (line.startsWith('>>>>>>>')) {
            // End of conflict
            inVersion1 = false;
            inVersion2 = false;
        } else if (inVersion1) {
            // Collect Version 1 lines
            version1Parts.push(line);
        } else if (inVersion2) {
            // Collect Version 2 lines
            version2Parts.push(line);
        }
    }

    return {
        version1: version1Parts.join('\n'),
        version2: version2Parts.join('\n')
    };
}

function mergeStashedStates(ourVersion: string, theirVersion: string): string | null {
    try {
        const ourState: StashedState = JSON.parse(ourVersion);
        const theirState: StashedState = JSON.parse(theirVersion);

        if (!isStashedState(ourState) || !isStashedState(theirState)) {
            throw new Error('Invalid StashedState format');
        }

        const mergedState: StashedState = {
            panelChats: [...new Map([...ourState.panelChats, ...theirState.panelChats].map(chat => [chat.id, chat])).values()],
            inlineChats: [...new Map([...ourState.inlineChats, ...theirState.inlineChats].map(chat => [chat.inline_chat_id, chat])).values()],
            schemaVersion: ourState.schemaVersion,
            deletedChats: {
                deletedMessageIDs: [...new Set([...ourState.deletedChats.deletedMessageIDs, ...theirState.deletedChats.deletedMessageIDs])],
                deletedPanelChatIDs: [...new Set([...ourState.deletedChats.deletedPanelChatIDs, ...theirState.deletedChats.deletedPanelChatIDs])]
            },
            kv_store: { ...ourState.kv_store, ...theirState.kv_store }
        };

        return JSON.stringify(mergedState, null, 2);
    } catch (error) {
        console.error('Error merging stashed states:', error);
        return null;
    }
}

async function mergeGzipFiles(version1: string, version2: string): Promise<string | null> {
    try {
        // Merge the JSON content directly (it's already decompressed)
        const mergedContent = mergeStashedStates(version1, version2);
        return mergedContent;
    } catch (error) {
        console.error('Error merging gzip files:', error);
        return null;
    }
}
    - **Model**: claude-3.5-sonnet
    - **Context**: /Users/kylel1/Documents/GitHub/gait-copilot/.gait/stashedPanelChats.json.gz
    - **Text**: does document.gettext() work with files that show - The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding.
    - **Response**: You've raised an important point. The `document.getText()` method typically doesn't work with binary files or files with unsupported text encodings. When VSCode encounters such files, it usually displays the message you mentioned instead of the file contents.

For gzip files, which are binary, we need to take a different approach. Here's how we can modify the code to handle this situation:

```typescript:src/automerge.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { StashedState, isStashedState } from './types';
import * as zlib from 'zlib';

// ... existing code ...

async function resolveMergeConflicts(document: vscode.TextDocument) {
    let text: string;
    if (document.fileName.endsWith('.gz')) {
        text = await readGzipFile(document.fileName);
    } else {
        text = document.getText();
    }

    const { version1, version2 } = extractConflictingVersions(text);

    if (version1 && version2) {
        let mergedContent: string | null = null;
        
        if (document.fileName.endsWith('stashedPanelChats.json.gz')) {
            mergedContent = await mergeGzipFiles(version1, version2);
        } else if (document.fileName.endsWith('stashedPanelChats.json')) {
            mergedContent = mergeStashedStates(version1, version2);
        }

        if (mergedContent) {
            if (document.fileName.endsWith('.gz')) {
                await writeGzipFile(document.fileName, mergedContent);
            } else {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), mergedContent);
                await vscode.workspace.applyEdit(edit);
            }
            await document.save();
            vscode.window.showInformationMessage(`Merge conflicts in ${path.basename(document.fileName)} automatically resolved.`);
        }
    }
}

async function readGzipFile(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    return new Promise((resolve, reject) => {
        zlib.gunzip(buffer, (err, result) => {
            if (err) reject(err);
            else resolve(result.toString('utf-8'));
        });
    });
}

async function writeGzipFile(filePath: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
        zlib.gzip(content, async (err, result) => {
            if (err) reject(err);
            else {
                await fs.writeFile(filePath, result);
                resolve();
            }
        });
    });
}

// ... existing code ...

async function mergeGzipFiles(version1: string, version2: string): Promise<string | null> {
    try {
        // Merge the JSON content directly (it's already decompressed)
        const mergedContent = mergeStashedStates(version1, version2);
        return mergedContent;
    } catch (error) {
        console.error('Error merging gzip files:', error);
        return null;
    }
}

// ... rest of the existing code ...
```

Here's an explanation of the changes:

1. We've added two new functions: `readGzipFile` and `writeGzipFile` to handle reading from and writing to gzip files directly.

2. In the `resolveMergeConflicts` function, we now check if the file ends with `.gz`. If it does, we use `readGzipFile` to read its contents instead of `document.getText()`.

3. When writing the merged content back, we use `writeGzipFile` for gzip files instead of using `vscode.WorkspaceEdit`.

4. The `mergeGzipFiles` function has been simplified because we're now working with decompressed content directly.

5. We're using the `fs/promises` API for file operations to keep things asynchronous and avoid blocking the main thread.

This approach should work with gzip files that VSCode can't display in the text editor. It reads the file contents directly from the file system, decompresses them, performs the merge, and then writes the merged content back to the file system in compressed form.

Remember to handle potential errors, especially around file reading and writing operations. Also, ensure that your extension has the necessary permissions to read and write files in the workspace.
 - **Expanded Context** + Whole file in context:
 �      ��v�6�0����%O�Ev�������Dgǉ?KN�l��$A5"6�C�%k�5������'9�
 	^�"[v&3R֊%, �B�n�z�B��4f��fboB^��B���	٣�-x��{��'K%�^[��W"Kg<���nјf<�I��U�^x,����Î?�Y'J�O��*���,I�g�OX �A�sF��m�AH-�-��V/t��纣>+�YҔ��[�4^EQ1Ɣьo��v��k�c�;8�w4q�۵�� �`B�sV��ć1<��C��Ck@ǁ���E��5�?��q�P�C5!��w ��՜f$H�� A��RMvB_����e����9ˁ�<&?q��9�VO�q0%�dsF84&s��"$r6�pA��%�i]��`	���[�������,J�gd�J��`�d	�`lI���.v&�2M.y����8ciH}֩�9	X�_��U\~��],w�IAI�I|�~�?�Q��'7��6/YL�J��3�4��d%���xb-f�=�u���y#k��]���5v�ti�v��;�����?�c�?-��Q��cf��l�2�;޸G�+c��4"�����{DEV}	$Jh`�8K�K��H
�g���U
�э���ʭ���Y�I���DF�@ }O��%���]�-Qlo&H�dD�P�+ݡ�ʈ��et��%�{�E��&����w�`Х<(B�#�`� �.��=<>$�1oEWt4dN�P��.��A0��n߷��������ǿ!�3�ݐ��ȶ-w0b�׷����A7�C�Pw#�?V��	�q�Z�ŷ�˕q1gi���Rxo)\N�q����(�Ҁ��(%g)�����?r�J�T^\G,r�$�
X�8�3Ͼ[y�f�ފG�a���k�3����	w�%���%����vWp`Lw7û�$q��������b	d|ص;N��4���!M��� HbK�:UX��hYi����.P�١�����rr!H�/�~fi�� n)�	�4��պ���?�L�kYb;g1K�+�`�(d0��|&���^������=g�K��������$���( ��L�i�tȃOc�J�NVdN/�1��hz�zΒ$D�L�1!�"?�dA�O���Oc���?>�V������]�t�<>����fb�~�Y�E�ψe)�ECz�����5c�����#N`�)����� H7��nCt������X��a����ٛ�[�I����-Y���L4�*]+�	Q���Ҁ,�T5u�R�����=X��X��k�,`�(V�W���� �����˔	�����-��[a�2�<J� �o��Oy�Ì�$L�(�R�L�-�&,M!�����9�q��(	�Y�Tp��6Y"G�*�A�!4"�(����why�3ʕ���d6|�]/Q`�{�'�!`�v- 72ϵ{H-���5
��գ6�Ƕ7fC���%�V�Au ���W�M�'���0~����/�D�cB�V)�{�)�ϛ�CȞ�h�}�ch��?�-��h��׶aq�`t�� ��7�VD��Wyu�ujI{�>Q�t�C��}��}�s\��FC��A����V�1���$[ -�2�*�V�XK��[[���␏r�(ؘ:��Sb@��������}�bL��t����M3��S~�qf�p���g�AV=�v8m��Y[�z� :�"#նfG���悈�Gjsa���b4^�Ц'�3\"�z���:.c���Ϭ�8��}��g�г�`�X�z�=g4wC�����R"�%�E��0�;�v��������]^���&��o}|�ݮ;����ݑ�20�h�b]���Ч��vӻ3 �'(��_��ĄL��{N���P��C�q�S���IRhw�̴�$!E�G�cN�b��q�ʃ����M��ܟce�}N#�y�9��IK�9��v��G!3t<G@�$�]�2�ZG�q�Hu�gp�T!��������%֍�c$�ٶA�>i�W�3mm7�Y1����
�isz#���<����J�6֠ͩ��(�����dq�k $E$�L?Z�П���x�ʄ�&b��	M��7�*�H�Bc����2B�A'#�Ȃ�ϥ		-HB��x��%��у{�D{m��%��I,�9�c��L�)Gg�l��t*��Ů��]��ZpQ���\}�〽��Ry/{Ф>�Ș��̟'d:��=2!qB�%K�� ޑ���͈3���ܘ=�U6OR	�<���,
]'��U,ZfM�B �[�&�U�Ad��l�<؀]>��/�+w
���� cX>&���=��n��$V��ҧ)l���V����4}���$�vQ�?[�m��c^�r};�FNoly�;ꍼ�?�ǟQ��������/P��,�;Lo���"jϾ�����K�={��n�m�AC��*HR0?��r��0�_[H��i�f5M�� F�;�gE��K��D-8�iLZ4�n�˃u�s ��!"�%�%�vI��#����3%��ާA��s:�����9-؇Tʓ3و���p�E�M 0��H�?f����0��@�Ё���C�=2>��l6�(0�i�i������p����2 �@���8��� kFI�퐓L���z�:�Sn+#X~ >�`����N�O���;d=k��rz.�^H��'�h�Z�=y[����7� �.��"�����
����9c�)�T��ٺ&�SE�8ٰ$I�>< �2��F1�2؉�sd�������Tw�i�6z��W1��XF窘#����V@��8�ؿ&��
�\-t6K`1_.YF�x6�lt�X&iW�e�(�dH��j� ���[I�&Ғ���<�a�H� eӎbo���1��c��~���F�`�����Obԭ_>�}��~�di
���M�9Ks�&�u(~~��k���9�F��;xU ��q�\ap�%nͧ� _��ؗqk��
f��D�1��8����c������d׀0r�(����s�
�	0������%�(#G��ʇ?�&�S����4͌I�G�'�uh �����S������l�2��Ö)Zd�_\���#���}-����#v4�Î'_��o�{�|�a�@|��!4�ff@�9(M��<�bQi�AL��3J��w��U�9e�Ӯ-����,�zM�K�N�V1�V����Xn�5mT?qXR�A;?Ƭ���M�Am�8���\g�-`&��|���z�I�@v�\x�ŗ��n�1b�Ŀ���S�s���=������F4�-;�8KoX#�G���s|۳]�3{��N������a��@t��Ύ�h��z`�`!]k�����5{��}�"��f/Eqx�������36$�6�lN^�r �Ҋ���J�ɻY"�%H����4&�'���+v��64P2�H�Q���"o|
7@�bԟKɦ��0Ҕ�$FA��#9у��ؗ%�y<�ȧ�{��4	���1xI>3r����4�HhO��9K��|��2���@���)xG���L�<���ɰwtXU�@�n����C&:z�R��P��@R�C�V�)���y�-��<&G�[�+9���@�da��r��Z�_�_�|�A�jL#N!XL7i�(�����H�Q\��2��t�ޔ�*��kUH�p4j	�?��r��\X4�9�$+x�K�s�Sg��|�/O��1�G��D�)�Z�8��&?{�G��>]�)=����%��u�]��bYm�x"�c�^�y8�or���VЏ�Z���=�?�M䓟�,6�J0�3xj����< W�Դ�md����!�`\Ȓ���:6����Ɇ���n`:m�61�cx�$(U��G����nh�Ra."��PbN��q���4,F�zV��ٛB7�'W9P�<7��i;���+|Vꭶu�;T����b`rQ䊯[�{~�����<I�,�U\��0�/rk1����ऩ�w�6��1�}��{#��#�����q��Cǯ{�>��(Msw�3n�����.b��ͮGS]�����hd�\��6�����f��4I��69�㩕*�:���4�t�t{��gGݍ�?;%�m����&Yl�.�JE���-��GC�䏫�<Y��<�i��\#���{�؃:{Đ�a�X��F���]k̂����e���?
� ��"�?��g xq��\�A��܁����?�[����p0rG����p#�����2<~��d�!�q�2yޠ^�(�B�p�7�1K��]ANZQ��8Cxp�%����3�=*�a@?P� g�ζQ]SD/�E�R����ѵ�-0�_�������� �ً�-5�J��Z� ��(`~"�(�L�T>�f�(s|�Γ\�D�C��V����/売H�E��M]��9gt��ˈg���4nv��C��$��x��X��9���NX d�����
����9�2a��)����� u�K�<8y�oғsPr�tf���%���:��G"8����9����*H�}�e���lN�!6�����[�c[�7���P�G��Ҥ;�Q����]�,[�1A�H���8$��P�Z�~����U������7��+���q�}VXkݕ�.��V;sM����Q�A��}p�qrD쇄���$�����?���s뱐�6��|�ߨ�2�Au�Ω�7��j}a�����Bl�ug��}nv���pi���N�ʚ�N���L�[s6�2�idK:����A�;4�+`�:��g�٦I��B������eӑ;��ď@��&c��e�N�-�(I���/IG���+��zE|�_C��j�G�ټj��G�=�*&W���+t�}A��2�D�$\e���)�q��aMx���:ɳF!�8^r�X=˸0�#0)A辺J�	}󹄼v�d�VB�a�iT������y�%�1��(�����&�k�hs+Jι/�錄 �';�Q�\`��D�%�9�j�2���f�:}K$q̲]��ub�Է�G��x��;��Kj��q�������3��Ϭ��č;T\w����މ���߱{/��g�_8�]��W�>PXj���v:VLT�'�me�Ѕ�N3�#�Sĸ5�i�
�1a�JJ�7��ߘ�!,A7�%_�c9oȟH} �� �[%��ƪV�����rS�1�h3���6�ڻ}�n>�
��k�F�Q�9����~˵���c-FRM}J����$f/1:��N�@��Ѽ+��;⾾v՟������e;0B�Ο�!���D	(�d%�!����H�[��>�*"u;�{`��C�����P�ޜ-����dQ�֊�}���~wl�F�g�N�ky#�Z=�g�FF��?N���&$KWlw�DI���|itWE��`��p��>ƌ}��p��R�i�K1�TD4�?}�mW�َ3t��w��?�Z�Bf {`�����h<`�G�G��;�g<� c6u�1�GVؐmg�X��طƐ�5��:�ًkB��݀$!"J�H�����
"cO� Aq
4i1��!u*�hʳ���A��R��n�[e�[Hdq�wS�vc���^�P���g�!k�������hx��\�~�A(I(}��-�pJ�n�V��<�,F��Ej�Sl��~���H;�_�iK%���@K�����T��{`����i������y*	��w�4��b��mv�N�����Fq��vs��J��,w�RS(�/I�X�2����h߄ɯ�H͢�������`� f<^��<U���^L���B��Ou~�U�[�T�isaA�#��M&Z84��P�MD��`����-#�z��ִ��O#�2B!S�2�s�5��F���rVN��R��>��[ �{,(��%/��M`����yTn�U��K�\�*:	']�������U,�����e�WZ7�' +�d�Y�����J��r�$Ђ��'�a�U����m�&�Ir-�r�Hšl+ٜ�[�,�hr���,dr�]�:��4�2�8=XN�����̐�jۛ��ˮ���H�7'�:F��/+��h��)�$
��L��;�$0��D��8Ny�,��0�k�o��A>��Q��No�u�7`�����7���k,t\{<��gb�_�U+eR\/��1f�'��	�y��,�,���'�0���H��s+��0��<X��upOYG�Ev/Y��_0�F\,`F⋑�I��Xe�)��$���@�[d�5�bʋ�g?ၴ8�V���-�����s����l��t��>S����z5�^���)0%y�/���O4<�hx�8^�0Y�dsӷ��Z�˧`�KWq�#8Ku��A��B���C��_�\Q�/�tm���ϋ���.do�f���&<�JE��� �R�K�����c�Vȳ�N~��{��+��#r5E�&��ՊF�&ZL	���\q&b'��9��5)]|̯"�flI�	9֎�|�^ex)����*0��,�1[e<�L����3���J:N��-�F�eKč�_���~����t:4=B���o�4���ه�&�Y�\Q�=��O(k�2)( @1�*���(W����a4p�2aNV�7�Wԧ�q����ɨ��������}����� *�NQ��uy;b4U���6w�Ѱ�����;� =���M�<.��;!�Fyd^T���N����'gm��4�g�*rZ@�B0����?��R0�n�u�<j�PT_��x����}�=)�z�y�������_ȋ�)��?ě�pK���"��$|�ku=ױ_�
�xUG��)��K���W����]�,yNӋ �����Q}R���W�:�c<�+#����aD��6�3���f��K�}�9� �0� �vs�$Q������ ^�����M�a�����f����B��B>-}��}��]�!��'�Yi�G�V�??>9{����<}����ϟB6��"S*�Tb��E��	����[����	~ R,Xr��%K5�6�!7�W�g�y��,z�t4`� iR���)���F�ᴟE�܌��CAKrj�Lc� ?�d���Ӡd!�c����j�����ˣ�����)�y���X�0r ;/��@8��A�eé!D!˰�5�b�hlѩ,r�WÐ@��1֫#������v�4��f~� �������0���{\O_/�PƄ0�����Mz�}��z���n��t���.�h��/	6BW�_J�S��A�HHe*7�Y��_T�'�_μa��+)e�K�hv�㦹�$�K�����˒���=���Rx�"^oW]����U#D54�CsJ,���,n�,�Ғ	�XOM�kkT4I��ïQ
���F���: җ)���T�mR�ۗ����Q��*�P.u��% !.$�◚�K������=Ȗ��6������u^Ĳ�Η&��ʬg�\�@�_���3AF���k��C� ci�3{.TɧH��+����Xr��)`$�a30���<��6f,R�]�*�R�[鼐Y����6cUD�3B�
V�����+V�U\�+�%Cήfށ��*i�$7=R5�\�F�7�}J{�l�1�r������`���A�LR�&��ئ	�j�_ֆ �rQģ8FWK�*N�Z	E�����V��r� Js��wCj���7?ܥ�=�������ч܏�{��\{l��r�еFl4�����~o��拄W%���h��U�bHk�w,���8��F�ٓ+���Q�HK���g��E��oK�'D,�B�ƴ��m0�����[](�$�r"t��H$z ����G�HҌ���m�d�B?�!t�Ţ*�I5Pȳ{G����(����t��v���I�ܠ��ޔ�{��P�
ӽ��o�053Uj�6�<!���w��83�^ ��V��"��K.;h���D1R%�xY)�?3�@l�Am��ï4f�J��%�o��t��(��+t�YjL7H��;� ��:��V�Ӫ��.��{�k��㣂����E���>=k@=�r��|صz� �v׳���*�o������*��*K _���}G� ���A�@��ه,��ѐY�a7�\�Z������G��{��GE�݉�t�C��"l�B�a��i�r'�F���~oh�uz��1'�4���H]�Y��]�J >0�>��Mb.L"PX�	���Σ���3*8rMYtv�� ��!v6OV���V?ZɯQ�V>l7wF�2#���`H�U�!��4��#g�M�M(䱂��6�G2J6$"i�U�DZл�6L���Lmb���ksAT��hʑ=|��k&�x�t�
��~ˮ.X^�l<r�GhW2���OΙ�������^I\��ey�2K������ԟaG���� ���|ϲ��**�4���!S�w��ږ5��������\�*���V�^с�ǥ,	Y�{]%y�mF���x�C���oY �8KyqtKZ�u)i$j�)��Hl�?���8�Z�ֻIR��T��>$�y*�6��	��iY�q�|a˘��	Ӓ�.D3����.��<�M�>���jL �gĞ���$���ʚ�uy5P%��v�Ǘ���?&��犁�Y���rk�ՙ�����܂Y���6�mJ��)"� ���;\E�C�Ȝ�u[?����+�Gpβ'��ǉȸ/��7��`ub�oȀ���;����%��C�>�+����d��:�*��K�	��NUP�E�zoU��ғ�dVF������
�'�ǗJ����j��U����7���b��1�ØĜ��&\�7�5}n+�.Ł���=�#V^^IT]�6�	��m�� 2x��"�dD1�.�Y����yB�	J8,�X#��*�P�Ӈ�u���j��WpCY�̳�����[ؖ���m��S�̶.�ͩ@9�8��Gr�?K��|�՜55;��f�;@-n�ߔonX3�'�K��Ѹ�~�`sEݜ���\%=Re3 u��~�  �_%qwtm�����i�#�ͨۅ��6۔d��9�u�J��e&���$�|O���,[nH��@�RrT��!U�m�"��n`Ub,�j����c�7
q?k� &��-M���e�*QB��R9�mbi,:y�kL�P�h��Kj��k�����?���ƿSդ
-R�< e����e�n!���؄�V���MJV�'�7�����+�?�Z���>~2�����S1���y��`:����t�7�IZM`�+��?䰖.�u���U��v�e00Lߵ1=�?+���yX]������fB6V��z!�XVm3'��OJ�9"���?tP�2:�߈�l�P�e.�EY���c: ��J�/��ך�y�\�.������X^B-�Ln��^h�r�3�t[��O��N����)^�A*�n�ySI#�9[�|IsX��m��	�Z�X���X�K�R{+CX�2��V�a4P|�䉚��/V��	�S��:�ͭ�Ta�&��p���2"����7�!�T��m��oD?�v�������vP\����<��7h��xm7����>֪��I�:Ln������`I�Z�k�e�;sW��(�"1����������K��N�=z20R��q�otG�^ލ?�Ao��S��x��|�%m�N��5�Om�U��ŅmY��d�Y��	�e����~Gϋϫ*wY����'�]�e{�U�K&�6����i�3��G�$�6w�y��ִ���)J�4j��d̸Q_!
�Όa.1e��+sÖ�_~�>W�UAH]N}G����/�1O�6"�	�[�A��1MK���Sz.�>��ּ.[@�����C]�k��Nr�e�O�?
�2���l �A���Ր#p�&�n����(m��x�y���ʺ�p���ҼWf&�A�:���ꊛ1��eXܓ3�dܽ��aC>�r�����V�;�,7������z���l�3{!e��;�@n��ǻ����z~��C6�^�r�n`�B�YC滬��F�q�3/ ��� Z�nWa+�O�bc��c�h0-�w������֘�p��)���Fw'W|8J�\����Ϣ� ����&��t2u�0������E���+��G�}��k�E�sG�
��,�H����L�V�֬|�Z����sC�cf�n�љ	�wh�t���-9mf8a3���ƴes\c*7~�᷷����Q�\��Z�D	���E���ynoo�M�R�nx�*j.�>CG�QP<��+Mģ�k��a���Ҡ�?�-Q�B�6��b*�@&�/�Jޕt����F�&�_�WFeX���j�9�Pt�	!N�c� z�e>M���Rx���!���(��im�	˝uDBс��:d���+�Q��%9�9�;H�K��z1,!ª��r&tH��lM��ܽ��#�dg�� �)���:~#_�{��8m�[����ϡa��CC)�	�4��U[�i!yH?)�&�Y貛��OY\ޢ�E��z>��Ε:"J�L��|����h�d{��@�ͬ�q��{���x��n�ytf�ѩ��=���2h��7�My�/ Q�(r��k]i@k�M#��U۱*�5�f��OzOכj/��{q��+ͩ�J��KVț�r+OU��-�D�[k|߭��ص�]*/ֶ.� k}Vƴ��o��Gw�a��Z%r�1"Q�JW��:@�M�*R�::M�1��q��$�]kݝT:7Z�n�ܻ��]~����y���;w䕙�)~*֓[I&�=喼g;������k�T6��&���Y��x�������i'��$[Ko[�ڰ��W'�Z �d��_��uT|�~i�����K��*��iӁ�wy��L����%�<w()�zcc�NnD���3�ĩ����'<�4B��7�P`��y���|�1�> ߐ���ܠ$W�6�	�1�m��n*�Q�k@������]h�c=�&+�rϪ�u�7���d7�h�W�7��V�Q�-�Y��j��;�͹�_2�Hw{<��}U���v�w� K�뺱�}��#�
�7�#;Sqڀ�h֙��Q8涚�%�8�F�-��*<р1��u�����������ˁ�[!/��i�1&\���W�k[�d���L�,��֩�,��,-�-3�{�*���.�I�GJ��s��I���{�׊�'@������9�X�rg&_Ė�V�Jm ����5��=���	���!�!J� �Ju4��ɻ��* �@&���q�'O��K��2�_:R�r�����ؕ��KѸn
�Q�Ѡ�kw.�Leh��hR�ZзG� "^"���1��е�-�-�"|�Ú��YE9���7	�
��pUN#���؊�ɉ$��5'D2fh��r�_�=���Q�H6�E)��-��Ʈ���s�@K���,a�m��9�ڤ����אe�՘b���\���F�?jA�Z��
�S8|��_�s�m��/ɀ�[Ls]1H�b1ƍ4]9�䋉I�}�r��}!�n\�g��L��㖂��� ��:b��n�rG]���my��(=�s���
�����p�Z��Yc�,o���x4`��g^�\�����7^:|{�X������a֘|+�^��4p�ϼf$���6���r=�r��"��%� �'Yy�����;)����Ɂ��^DC����7Wg1;.��ǅ*�Q�	�;�~R�ʵ!h���|����"O*���1�4��(ή��MJy��/t� ���T~�R>)J.(���sS���@��J!��K�p�W�x�q�۵X?d�뺾��
\�c�o��b��:����y�I�����c�.��c[~�u-7��h��,���a>���䮀*��qH�%�D��8$��F�� e$@�����!&E���2��\��A0L��`y���H�4�(J�x�J�4#�j�ʗ[��S%s8��rsp�@��	�w�8+e˔	�����-5��]Qʣ�w�>K�=>Q�{s�HufA�쫷���
�V�4�գ����*!rs�%)_��J#~�����c���p宒Q�ÃuU6�繵O�FW�I���đJk�����h��:������o�^�W_Up�ub�@����[���� ^��+�f�2X@�̩p�����cn�u��,mMl@�t����-�U���iP�A�(����!�a��z�kY����W�����ʍ�O$+7�g��+�A�?V�C^Rr�,����K1U��|�s<jm)��C~�x�$��1<g�R��)�/d�y����+��q��O��%��T��#䣔(�"�������ٶmzA`��Xth�a��1D}jf)�����ʓ�w�\�q��졥���M�c���u��$Z-@jp۰8�P�޺�Q��M����U_b��t6B��sQ��IZ��50.(�N���ݝ���:6��x��G�ˁR^��~'�����[>wʽ�}>���2���Բ�P����E]�Y����n�G���\��WF����B^Y��T��ȥ(�K��$YոF�1s�A`9���;��n�
(F��um�QWob�'�ag8t?@��쐍�>���Znwط�l8��>w���x��%��@@8I0�\���Y����A1bJ����F'HRP��=���J.���g�j�}L����E��pb���'��E�{A�,A'{\BV� R��1���ԟ����')@����7�kG� AJc}��9���%��ʩ�H�}�
h��6U;mM��W��C�-�e�/<�ⱽKk�	�<��uxxk>#��:��{�7zd�������
��X�����nֿ^�j����
�nl%W��Tۀ׶��4�����y��e��rm�Yހ�-�?�c���n�s<�x�C{?�N��$���	���y�,�'��=
XFy��6�#��� T���[l��Dv/�� F�O���w݁�e		�;�����c����dr���_�Ȗ�܈$�P�}B�_#���ʟ
A~Ͻ��ׇ������%8G��a�����i������=z�>v`;��a����tv�嵓K���8���������&-��w��"I�1JG��a��?�,�I�T�wg�m{���]��8�k_V�<��˳�O�T^V}Y���i�}"Q�:��v�BG�� ��Uy% T���sу���%�hz�'�׀�VO�ZW5�t�͓�g׵���ؿ��l�����m�ɢڸ���m]����7���V�]�t��/�ܭ�/�j�eKQ}x�~�`C�V��ʭ�T`k���"=gqms�	$`y(��!>�zP��9g�:������y±Uy�ۯ�tqD����\'��ߍ;����IYo�䪾J�qȽ�Q���2�;�p#�:-�S|��".�,m�ksO[���h���ygbi`X�ewv'�H������e���̩x���z�R-�<���I�����诗�I�>�>�.��R;'�[�(��� ��Q�m�+)��@I��~��y���R�38�j�kHہ|)�����w�NLxwJZ�t{�����+Y��R�D�C�%I���;�g�DVG�2�Z��b	��v�����Δy���^@蚼�^m�t�JOq}$u�g�J4�h��,�^���'o+Lr!�D/�%�@���ͣ	����K����Y�,����:N}�-j,o�V_��\�X�w��s��K^��:����Z�ߝq�$�Ñ���:��ź��`sKm��
^coк�P����q�qϵ�n�[��4�tl9�p������o�$��Z���Ֆk�Pžk���]�d4zѥh�]۶on�	�ַV�v:Ґ�������jFYF���̫\��R��^�������5�W�]�Ƀ�c=x�FK���v�fjϛ�7�W0���p�����%y����������~�;�3ڿ`�m�������WOO���6yt�PÁ���R���8 �Ms����M���3�N�f�ω����[c���$�_Um���fa�*Ԙ�ײ,9H��T�"��@���L���oc���w�&��F�؋��"&�;q�f?W)��	��w�A�7�8n��c0P������*���0!4u�Ua�Л��M��ޠ�孻�A�8g<�J���c���|8�jq�?q��N��e��i��׋d%�����p�8M~���K�q�Y�{@^�:l�g)t�R�X&xMj?N6�����Γ�BL��=q��=�A�"<B��ʘ�F�iI�E0!��K����� �ׂzV�m���O���yNcz�������M������le._<~���ӳ�/�[v�ac��j���7����,�����.�4{G��{�2�~�0K�/���t&p,6-�Na6�)]�?{�������&��x��+���z��̵�i����������ܾ���A�3l�'�<{��p�۬���o��Y��x�/�d�����J2�ˠe��TSyv�/�$�m��XE�Kml��3p�I/�-����x0a�[��U���y;,[�ټ����r��� ݵ����M�?�w�޻[��{w뽻��ݺ��|v�n�0�{w뽻��ݪܻ[�ݭk��{w뽻U�p�n�w�޻[�ݭ���{w뽻���z�n�w�޻[k?��^��7o��UO��T�x[?���a�{�C۝/7f����x�~�z��ʣTx���Hk�#^�B�i���Si��:��`zq�M�kS�~/M1+�+S��{a�L�K�E�e)Z��*ESӋR�5k�&Ň��d��Y���� B�^���-^���F��i���(�[�ث:)� �L�+Q�]�(��֘������U�B�u[���^c�Ձo���V���zX����U�C���ec|�վҠ�J_�j����6X᫬�ju7&Հ\ênX��7�z�o��o%�&+xiwm�zW��+�1wӪ]oX���n�Z�XY�Jm�U�L�ڠ���w�2��A�Uٰ&7X��4��j\m�̗�X�kp�
l x��.[y?��4Zq8�V۽�4|Z����b�+>��=� ۲��@O�U�dMm��֭�����X�i�����t����XPoɊiX/�������J���wa���l���Ț-��Dj]�*Ok�W���)?��An.Y�l���/~b���-~Z���+~f�⧲)~:��ohO�d���gG̭��d���V
���E�6��!eçk��Q~�w�Z���a���kz�9Űql�%\��k<v�Þ� �����1�G��8�o{���o\%Ҽ��!MƜ�9�7��ҫ"��1˳�:Y�RFX�C�n�� ����u�/�i��R�§KU�H���j���:���%@l<�DɌp��/�"]�<c?���NYQ!�C�gYKȂlת���>�օ�0u��D�y��HF�����颤Qu���BQ`�]U�aN ����H���˄PcH"\�,��r��PY���#2����{���gk	�r��'4Uk�I�`~h�zxH^	V�v�C�@�y�a��j���d�#2�aj�y�̟'��T��@d�W�Sd�kC�u���!��|��������ݴȯ9�/ߗV�j��L�X��0`��8�|�R_/�WY���c�c��}5�|��u�3+
'Τ��LXo(���	L���J�/K/㛼�)T��e�p���(��s��"6u:�g\!ƂV�|�F��t$��ą��(����E6 �8,"�Mg*��a�*w<,��D��b���Ŵ�� �+,Z�*+>3+�)�����?�i��cށ[q�lp���6�
�i���c��������۲�4���8����{grl!*zӁS�l��V#��^�dqM�v�ڿ���`���Z�;�ހ��bd�Zc���`,�%|���c5>��c������O��T���ٷ�2b0d��`�"N�:�>m�	�s��˓�׵�9�D��`�<o8��Nl�~е��p`�='Ao�u7����s0�pOqwg��1}L������1}L��Ӆ	��4ݷ2�'���NP�V��K��r�H���Cz��f���:F��`h��5�f����z���t�#�s�����yfS���Z�~')z��0���'��Ozs���u����� ������R�2��%��nb���A��}e��n_�=-JN�����`�D�U�)�0��[�+���%X`���׫���~Ku�3ݤ�vd�GkTk}�����GV�������ك�ճ����4���R�	�E,	%6W�F�u��9����мhK���C��5	�����I�O���J�6`*��ʒ��g�=x�$`!]EY�|�\�K����.tyE��0)��SF7���l�}%=�6ѵ̡�.�
(�G��4�����#����~a���+2
W��M]#�~���и����7$���L�H��Sكz���`/E|��~ @uPj:�O�h��� �T`�T��\I~�A�|nxG�C��FL�WĲΣă���b�(�M�50��|H+�0Z� mI�gma�{�nr<�I�םV5}s�8V$���V<ţ��� )�+T�m_��gdV
���f�O<I�L�2��n>O����=B!7���*��zh�[�Oܮ��*���Nc].[���Q�~��v�9�^i�㑵��eb�Yo�|���6��{�Hn�Q����u���=�	�C"7%�ZʲU��:b�l�qƭ�Nȣ����&I�h�.��t�]|Ҝ�����4��o6{�
7P���w��k��|�> Q[7zr���	�W�i B�r���]����@�G��<k<t���ƞ�y�p��>A����yh�������yh~�C�>��ڿe$å [���%���
i���?��Q��;98�W}Ɩ3�,7��h8`���۽�8��AM����y}M��}|�}|�}|�}|�=׻w��?�ܵ��[�s������~������II]����wW@����y��')^��<j�����:���y�
��?9��>�_kv1�t�"H|�pB,��X������M���(�Q�������5?��0���S~T��בie��'�>ډLכ�*}�Y�����y�`���0b�g�[c[�ٯ�>����"v�1F	����Ă����~�����1��cH�.{�d�u����l�gɫ�'k��t�080O0A4��t�zY��"	��t��W��۳�/�]V=/�{�����Bz�}�e�mѮ=��a`��=�����!���bE���^�E�<# J{��%M�#*fWD�e�Z����T��CV+�rG��ގ�,�.uA�7t��Ȃe�$�/�K�K����C��=��e@3�+u;�P7H�e�t�ъ,]��*e�i��[�"IkF�Ӌ��}è��;.`_�B��^�1<U�s �є,�U_UJ����Q���K��M}�v|��ڤ��X��;x;�C9�i璳+�;�@�´u<$�_����+��1�{:\���U�CV!�[P�s�� ��yr��J���o�ė4��5������������O���	�E�'��rz����������ɏ?�	���%�H��$i�R����9]���ܐ��!r���U~���*B���>��}C�o�1rttDZ�� ϵ�pʴ*�t���a�6S�;H�������$(�p�ij$G�Hl��p�wF�s��|��i�h�J��&�e4����dNUD��0�ի�'u p��zk��o;�9�"��n'b�y6'1v�zX%D�7���9"6��J�_7�['�rH�`�]���a7�E�m��Z����o��M��h"����WL�G�����!�[؈9y g�d��M�ࠓ%'�?�b���u4����3��X��~?!��<������x��hZ#�i�+{�M��O�(��edBZ�5��C�p��aa�s$|���*����O3�`"����v+��:r$g=<D���^�;S��ɐ=n��}E/)�0b�`�4R�>�Ǖ��u�.Xښ<X�"�%�@�a3Y���7ޖ��ʆ�)o���������|[���3,"󖤘�GW�3�@Z�.�Pi6�d�JG�
6�"l����^6��ӊ	71���X��TdN�%�9�3�I|V=~f��L��E[��X�g(8�</���D��%qt-�|��
�L��.a�9E�����rښ�ă�����J��7��0���>xVl�Yg�;�ir�C������w�F�m��cƒ��Wgk93y�,��*B\���$6��s�L����Yj̚�*��	�Qd�c�d�*�j�ʨJ�2e�b�:�>$c�Y0�tZ���/�ׂ@^0�l���X"~Ya�F�����<MVK�25�|����x���_i^�x+��Ge�OtM�b�]�Yc�XCE8���T�9�d������gM*��~�*��iaPn�}A�<E��NY[��	��ڍ�r�|٠m�=����ݛ��Iw���)����1!�K�� ��^[��M/�5���'�#kh��E�w-:ږ��;���8�����*QyA��|���[�����.nm$h�Ck� l�����7Γ�=�m�p��[�Z7�Fv4�6�aq��8w]�Ƹ��a��\Њ^>]��yu+���~�[+c@�I(��1�H�R6��`"U�:Bȿ��ք����<��|�'P��A����fuP��Y��2����P���PY��c��F��cх��W��kv��)��偠Ko�R%���Yş�]�Ǐ��XAa�Q�V�EW�M����e7��`gV,�j�^��X�q�4c1^P�Pu��L,���傜N_*�ֈ�@6��Xm��-�/|F��`7;�4�ȶ�䵄d��-@�Iq�H�
@e�l�%J��+�T2K�b��|/[�7��1W�U&��%�1�d�kF[��8,q�l5�G��p7.weHUxܺ�l���Q���jU.�n1Q�b�J���튠�mS|Yh��5�=��u��_�c��XkkZ+َ)`�5x6��(���{]�YH6r
l3�0z4G=�e��ٻ�̾:^� ~��0���xˍ`��+�����"^���2���&����BۇB���n�51@��7��RWßEn扁w4�):\CM?�z�v,�P�;�Nq�&���f����� ���������c<-�v�od؛���j�o���a�z�!�؆@�l������9S��&7�\mM�&�?�y��`�e�V�6��(K�Oa�6u��*z�M���ն!k�:�3b���qh�}�Y��m[�ϣnw�?�Y'��{�Ɯm`K�Uh��u0�zS2�]\�Y�"��Vƺ�x��L����c��؞�:C���^h��طmg��qX�#d ��XTR@���s��s�[dQ��5�,!�Q$�.&�ƕ��r��+�K�x�2���|����B�	Xs��r�y����yV�� ﺦB�Q�4�Fhs�<S����$|�O/�)[�7Eè����6f�(������@��@�%Pư������a�`%K�h��7p�V6�4[��7[�FQ�{�|�1��®d���)��!�3����mK�SA���W�
�Or6`Hg�w���J����p�u-8I�4�城H�F�r��oU�R�k^״={�'�Oĩ��a}}���s-�⫯�.���!��Oɜ��.���Ӥ��Ĉ��G1��B�O�\VLg�w����9$ �;i0�7�i����-q��r%���JV���攳�*0�e�Ǜv��Zn|k�Zf
�>��#�-jq	���\>�v��p "�B`��	��2��Z.�(Sl�-#@$C��Ĥ!{
f4��e�,[�g#]:ݴq�PcI�D-#C�#?>i	�3���T��A��l�lLxs��0�H��TU���� ��@PT����1+����h�j�)�����j΋�B)It)��R�a2�@�F"!�qA$Zs���a�*�z��#KP�o&B,���Tp*!��N�;���`�bR0���5&C� 1Y�O$U�-�:�e"�x�3��*IJ(	x�6�L�g����Z�ΣQ��Ws�b�`�=Ďl�/��`ܧ���F`_�ck4�v-7t�Q��n�ȧ�9��Ҷ���Kh\����%������]ob ��c�k9�7�^���|4�Jbҹ3>��?�ڝ��t�M&�D�Ƙ�zݞ�X]�-����X�r���1��Fc$��d�\���;d@�zd�5YS�#R�ѵ�&�%��e��I^�p����}l}��Ֆ�g�Y��sv�c�8��t؁��C�z���a�=/8`&�\
?�{�TQ���T�k!)�'ZP'��X:Z�=�LÈf�	'�j�m��A�b:
���|'�_�����g�����}���	5bV����S�1L�8Qw��:Y6G��X���f4=��Uʋ�!xS?��t�xv����w���W6�Ocp�-�Q�mV������zC{����b�����ߨK���<˖X@�<~������C;��'�\gQEQ�����cqA�)12��l�]x�|U��J��[g�p������$�%ǒǖW=��$(�D�4�^⺣x���#EVz���)w��wb�R�g�e6\EQi?א��5��)�VR"k���(��	s*��4b�3y���)�H�x]~!0��J�����
2ς�̣@
R�4��QAv�՜������p���2�L�2� $���΍�v�8�Y�5XO0��"*抏
��Ԡ�Y�D��6�ɍ�,2�b�K�f%0�Z>g�*L(	�E'mnAS�-.�ҕ�<	1y�<j��
�$K���|�MM���l$�q�e�����͙^jQy_�od�`�F�*2O�Б3��b7��x��>�ԂY��娌����J{F�q�qϵ�n�[���1$�v�8�B�����sg��
y*�ir�|ܷU�$��ӈ.����m�77�@�[{D����4Wh3h8�<�f]K6��'W,M칱�����8�<h�T9SOȜEK8mI�|3���c*R�Eo%z�m#��8�&1�)���ٳ7)U��̱�(R�B�&�U��B��7EM�0� ���e�:절j+��9�Y�� M �߿��q�嶘F����/b2���wr�����;���&�[@?�tj/d��{�3��TJ9��+�ۛ8�u]-xv�>�%��y8�IwT _�k�G��8�jSp�?qE7������4N��E���ewn8q�Zow��|�>n
1� p��[y��8w���2�(V�'���F���y�\��ӳ'�����n^���%w'�)����`BZ�T����ܒ��*?��������t�����`�;�?�u�������l�\2�����ϟ�=})����K�)�d8b�M����lIgv9�/%���d�u�X�	���+�+��QU�xLj�BHS�,[�!gs#zA������I�+12���>�n����E_$w��;��^ɵ^�~����U$��ÈA.���	6��q�,x����M��|/;����V���a���$���e|W�F�z�BP�D�$�ZK�ڽl}Dfs��6����D:m��k����D�]�8"3������T�_����E~́}��� 7e3�`� �#9��!vN�/�#&*KT�V͢��w�ݭU�j?��;�����ۆ<�6�b�]Rહ��v�����SA����Q�w��!?�氿"+!��IGR����H+���Dp�W�q0��ɀ|�7�eg���%�/�U1�u����Z2�f������KE+�;��j�ne�U*���x4�϶���Q��V�Q����p�WO֑I��涌�;���
��Ќ��S����_�$�Oчń�u\�ѵ\p�KVB^����������I��sy��T��b�X�u�y7%�*���r�m���;��o�.]%kM��ӹJ���Coܵ�X.��Q��V���Fn��6�~nWI~:ޥ{d#��8����v}k�;p͹7�F��my6������F�����[���V����C���*h�zQ�-�E�]���S����gk��ݪD�(�X ��Q��wQ*�+�Usح*�E��JB�wWj�J�I�AUC��ՠkA�Nf޽Tu0�������T�__�ٞU��{�e�{]�r��m�޸o��h4`~0t���g��!No|�C�@1Ӈ�>{>�|���	��Vo4!Dc`�h߱��8R�����3S����k.wK<[���È^嗉t��L��q�������g�[6��;�,��V0��Q���>����Y�;��߱��� 
C{0�G�E�б\oܳ�Ƭa?����C��Q���G .$!A��
 �-�zn7�����\�X�Rj�#g0���v���� \20.y���#�0S0�
u���5�s�e�U���b�
��C�<�(��B�żoSF/Ф��3����mM��gX6o����$� �>!�PѠ;OR�7i�Z��e"0�[��2)���8��+��~��7i!��RΑ-�2We|�A� �`f�$$�.��w4`>_Ј�bv��0�s�/�L�&�i9���9�E[Ϡ2�\���"R�ܒ�����^��h9��jnC�l3W�?�x���LӉ�Ӕm��@�=�8:i�B��-���aGfdI�z�pc��/]�O�E�BB^� $�Fq"��D� �FdQ_�ԃ$+I�<'IH��焊��TRz��I�LA���.�2]��Hc����������؂�!�
���X�}��&!��s���Ih�S{Ï��glq���kY$�t�Q�k�=oh��c��1��{�����7�ao�s�7>>���	�����Y93��][҉����e����;f��Y,�,�;Z�O�^���^��}����cw�n��~:������X�G}�s�������z�hs���4��$��q��	S�����B^ơ�����*��������1K�Gt�9���E�C���][�k���SK���z>����W����wQJ�Jw0���<�H��Y��G��Ә< ?K����}�V��8�5�̿����3��^0Hj�g��a��M�{��to�g��J�[�ܱ빕�z��]ߴڤx���e�t��5��26��������s�XCQk��1 "�֪�^>���c�F��d-W6��|��i!���۩_t*Mģ�k[�0�@�!P��y��U�K� ���J��I1"��4�>'�^��0Y�A�r �X+���;�8FT���ӑ%�ڐ�*�m�×4��� �5�?�����s5�3�Z̮Y�F���Y-gg^6�ٝ��*(K��%c�~������,�9�bOm�fDC���H����r��ܸx&t�����'/�譆ʂiY(�e� �Lx,�,��*� �9hE�}��b���wT�bC&ֵN7Y�"�G�S�a���h�kVI)R���GӂQZ0xq�8���^�[(Qe�̫aJ_�� �2����r=ه���y�z� reDm�wb%H�'�����Knٚ��~
��n%�B�X+�ҥ�H9WiL�4cLZ�#E `2�J�y��6k����q���y��>��9��X dr�T��!��~���|ǝ:��ч>Ո���=�aM���[�q������z�h8���Q~z�D���pz��zx%zP��b�ۗ�,LU�]V���ܘ�*��;�L/e��S`�Wk�Ƒ�H�_o���A]�R�ܡ��� ;�����J�ʳ˶�B$�V Q2�*��V��$�J�_�+Ly�0�J۞�������kX]jG����Q�'I��7�WTQ�D�����Ndj��p�D#h�zݽ˞�v��+�i;6�EK���3����s�2�f���C�U+� D+�D�m흅�=���J�0�[N7�J�!�[�7����p_�+�wYU!��E��ι(Z���~|���l���O�'�/?<z�_��[x<�P~L���lF^z�D�kI��Y��ݻ�Ná��o���JZh���=���-��T1�Ԫ�\SF��vj���GT�4��:͘g�m�.8A&��$��a�0er:�|�
�=��Gl�����ܑ�g=[���m���{x�D��gʕfN_zTo�ezޚ� "��~�΀-�ѵ�?w�$�8bxR ���J�PVBH7�j�X��(�����/�_|��]/yBO?�@ˋF����y����;wfxi��5��^�����%�x2��t;�a���.׳�+!cd%m�z�ݹ��(���hO
:��Q��7*�넼(���}�)������׍�V�WKNoIOY�`F�|M��fΖM���Gs��́Q�jcj�u��v��7�4Mb�Ch��(�X�L��L�9�L�����1�g	P�����^�����%�,��҆�0Vm�����c9j
"�4p�X���wqV�O\C�I�)W�8O�kYbWP�a����"c�c�潼��ïy��Nx�_���2���$:���Xy�h[(T�rKΡ�z�+K3������w+��4�^������K>z��F1Խ<��!@C���3�b�c~��嬁�@�@1�"[n���E�Lp�/�F�je��$�F�I�{�h4��a0��t0�z�ߟ�Q�7��˦՛������g�/�ޠ��t����Л��C/��h(�`�ߎNl)\K�/2!�?����7j;%-�L��8~K��Պ���$�O��EJ��8Uò��m�#�+)�낵q�Þ?���S�-���]Ǡ�^��!Cͷ�TS�#�ִqd��Q�L�����*�D�����Z���G�Qi�5����mm:{���OvO%lt���.��l��9@`Ʀµ�5�sxMs�6�M���D��^� n�z��$�[C,U��{�{�6:����Ik�,��{Gu��쳭J�JmnI��4��(ٵ@��Dn�2�g��.�.�V,��S��S�$�U���5a��" P�����$j8�>�R�0�A��C��l�rTx��ℰ唋��Ci��6����}-���Ʒ����n>��-�CKs�J"bD
7�FA�ɧ�ĳ,W<P��o���Y,�J�:�~:����k��r%$?ZM�� �MHE�e���s�<�?ْ��|�wy��e��i���<�>Ϧ�8?-���>,���!��ۆJo�����f��\d�Ƒ� �X�dK���&�o��[bn���oD����A�m���p��� �)�(��	���$�ooq?4��pp�N���v���qa	u=�H������*G��ycf��W�Un��Ó�(I�uQ�k��
�&��Y���`�W=+�i��t<��7�^q۩�F7�����M/��� V�����bv��M-�1>��r��N��&_����'��~��Bn�l{�&ѳ�u��_�r�mμ�<��+�U��zy������7*ޤV��4���x��<@�������*Ϲ������H ejK(zύ����aY�}�ҁpA�S�ߥ�pK�������:���4��S��{�����t$�߮��4ӛ�N�fn�Gqk�Z��6��~ŭ�U�b��G�{�`�J7�Ǹ�o��q�~H=M����l�fn��qk�˱�����D��ּ���m�&z ��FK���Cn7���l{��8}���tK�ߧ����?�]�L�����R�ߧَ���r{��˭|3��[�#��O�U�s��>�m����=�������ϜA�ԱЕ��=�Q��F�@��!�Q�N�Y/ߒ;k�X��Pyy�����O�wo�uy����O�S���~0|ᣓ�fJ����i��G���FQu;E�ǒ�n#��.$�OqA�gv�@'|?v�qOx�	4�~�s>��9�5���=1��TtK�����L��>�=Q�S��ٴ��h�.�IU���u�[ڏLƱ},��dd�)�g7v&+���ٙ��}�)%:�q���qӦ��8Wͦ�W5�na�UI�A`��Um��i�꼀�)Dc��0]B�\��N5��Xhi�eٶ���:��mn����U��ߙ�t�Β���)����	�fT��a�������3ZU�,��<�#�pO�
��0`��^:t��� ����U? �z������S����z��o�&��H�݅4��!���� ��u�$��g̱����a]�`�b��Y��*.N��?K��2*��v����D�m#���~����v��b�n�w�R-1�����v�ބ���`<��>���ӇHgE�&�0	���h2�=�;�B����b�L��v���L���Q/�C��M�����z��t:�Fb�hSjvVyw픛~�`�F�m{)+������hoʫ��m��V�����}����3�~� �-��KSP:�մ�~e}�Fc�ͺpc�|�[Bi�9k�*J�4�sL��(�� ���G�D��ן�$\����T^N��s~(��J�2S��X��|�֌�c�y=�a|c��?�̴r+�C+B�=�T$��m�Tf����J	|Lc*%Q-��g��,�1X>c�|�`����π��o��(J���!�N}�4g�<Q���_�p��AQ@�P����P�͏~���~�LE���|��Q珀P2�|h �I禐#� #��1���} vy/���B��.�5�DbT���[�`�l��!���Z�g�>xj/�1y|�C����ǜ{|���<����?k�	4H|��_C1�~(<.���Lá7�Nz��?��|�χc��7!��L��"�qϏBȿ6��p1��i8�ԛ����n��&�L��h������#�d	��Q�M�����o�TLiQ)Aj���6��7\ �Nf"�@�5��R�ce�A�F|���E஑���qڂ`�@	�N'��
���ޙFn����~�A����b��hĿ:-���VI��*��4G���i����/�B��'k��_����,���$��V��̂��h�2�t
��S���:�*%QlfV����^v_}۱J'_ơhu�l�=�tg?'Ԏ�P��X^� ����X���_u�"9/.��z���hq	��߂�c�Y&�W���4�M��֘*�	��Ǫ�c�]��.�\�F�$A7����v����VK~��z�x{Ď�aF+��Z�x#�.� Yx��Yx�_i��G��2U5𕈥2�
J�G�=X�=��j���ʁaf9<�`����Jح�a�rɞS�[��W����e����5��v�5CW��3Rg�2��j;m,+���+�����oe�/Y��6|�?cs�c��|��w=w*��lЇ����g�z՛��4+��=cî��o۷g���vkV���P���)���6�@���(R�VUg_�fAǩdS�.׶�E��a5��:jl��UԢLi����6��{�N�mc�mc�6&��˘�-���F��f��������t���l���Z���j���w���l��l�ۚk�ٞ���L۔��t����k3�6�H���R��GM�R-- ���_����>�>zi���_� w.�;MW��<߬֔�r��x$X�HT��?`�!	%��z���6����fBq�����2;�|��3�_��%�1�խ_ i&���2�j-��#PGS_����L$�X�R�ʲ(�҅��'M�H���E�+�S��c	�(���Զ����3X��2�Ki'G��TE�&1�4�(C?�51��<,�)H�ްs�"	����-�I[��b��K	gEڀ� �����y\�X.�!^�8�t�� ���x��� TՓ�7�
�D2�8�l+�}'�Z��B���������O���Z���i��
/����$��Q䍻�p�&|4��OZ��h�͆�N<�MZ��p�x��=���p���Ɯ�Ŵ?�nO�V{�M��밢�:l;��;=��C�na9CXN��%��60(
k�� 8���q>9�aNW�(M�W�0�,^ʻn�1�Y��"R�\�̞\lr�<P��Z��7��qw�2����"+��5�5/��ݴY�)X\� ~����nWV�^��:��s��*��(�P�4ڗV�x)<���_q!��R��Je�
t(��J�D^�W��qX�(�P��\�x�nr2a�[^ �$p'�M�P�N`*?��0ö��gx�,�� �=��~�$C��ټ���	�p	v(C�nGp�~$*�.���P ��4I�q�IA�䈢�������Ȭs��E�HKR�W�M���1U��M`�T?:��33�k�sS.7��孏)��k�ƈ�͓�R7�ci�rRG3�d�a�g�&�F��֚B�?�Y�'rL�Zh�c��GvAHF��:h!������1����ei����za�����R����N1��+�9����ӈ��$O��(i�_��n`�";:��9q28�]g"�C�S�4f��^�˕�|5����AJ4�p	���y~Qu�ʄm�eɬ�	���Zal198�V�1]MX�,HCN�ǗWL���k#�p�JXKt�;m���P�o`9-L��Эe��-R��,�(�>��j�k��/��ᜎ��!D�e;�٤���r�4�
���n�v�1C�bn�0�K���{/IW��6��� �&o����w�7���-���w������]Dz��c�b$�ڪ�\ 0F]��j~S�D�R�fؒ jū�0g�^AЉ4\+�lB�Ig$�~��ĽJ��8��5�ʸ>�t�d��������|����C����`��}\~cO2��n4�������q�M��������a2��
�=B"��G��`�͋4��2p�$�Zu%k}x�&��?��}����Ij�Z�$��ﺼ�2R�s������*	#���POXy1�֣�]
��Hg�pJ����r���Ķ(��E'�*ݫ5{)X��b4�F��,X���zi�ԓ �,N���d�����d�S0]�%a������&�Œr`����� d����QG��g�NUR��9;Oӈ�9Tۢ�')n#�Z��T�6��i�ɋ<�]�ԁ��1{(���cԏ��v��$ ��?��K?%��kq�C�G�
����Hꞓ(#�%���{vFj|L+�8�TN�<�&��$M<\ ˚/T�.��;��밇�W��m�h[TƗyꐚE_q��-��J)^8��8��+�E�b`���#|��oDv!x�a?�v�`�Dq���^��m�g���#��4���V� ������"gszj���7�����v5����u�H�V���E)�h%����*7w�/"��`yl�8��ϒ����.exQF�JOƙ��B�氋�{���1"Lm�ש�9����E�S"��[�KZ%��&�O���?����ɱu�ɨ�.Q�BGFƄ֙E����2N���ã���?bm��e��6�V��mck"�e&8E ��73�4Ҷ��Q�R��*�8��"S�a���-�2"˙D��7���:��i��g�#%�$����s@�V!yβ)�����razB��7��ڤ���1ڵ����.�"9Q�$A[l.x��1��/�E���"��I���0�tk�.%U"E4n�y.
��`S))���<k��/R�`��b5�(�,�ĳ�<e�7y�|#�y�������f�椐�D�6�o@ìh\�E�.��:$WI��Fb)���UG4A�K�Azy�5F�!���$uϐ�}^�K�������U�y�NƹTT1b��8M����㈫��vW=�6]���s\TJ�VOyO��&
��*P��N������x�>%2gAG����OğO���S������y�ق����j��["�Z�SI�-��"�z�?�|?�^0Z�b4�x0���&6~�����l��L��[���h�M|o*F=�c/�ޢ�/F=?�^��5x�p�9�׫^:�zi�v�Ϸ��[��-���|���?�x�)�Q/_��r�Wt��\~E@��~(�p�M#x~�u�{!�,�(�O����u�/VǾ���8d>��D�'_�F�?={8�z�^8�D4��&����>4�Ėf���p�E�l��1��<����R�)�_��=1�{�0{�`� ������ɤ�"�#��F3ߟu'�;���?�?�u'�d4Yx��7�&Qxa7���q4��-@b8�̊7���Z�'|Wm�>fnbU>v`�;.��n Oe2 sb�xs�r��ccCj\����67/ N)+i� ��/c�h�F�⪹���2�o�� 9������Hv����V��j�Н+��*P�U׫�3 ׯ��o�a.��}Lٜ� ��&B���(*��%Du�?\TM$�VZ.y�J��m��4��58�կ�58�Jk+	��܏��<T �(T�)�jtG�*k��U�FT���/����ڕ�k�U�����B�h�-��=ƾ���CŌ	aT�`�28�Z�:������u2��UT���M�@�����
�|���BzG&���ĉ�3��Eށ�wz��-��6;�orh�@ޑu��F�Y�����c�ѩ(Z%h�Oj6B5]��x���dY5J��_�%,A�8��Q�4Bps^��+w��&(�����	s��<� A�Z����t>�M�-����3�9�s���;R}Q�t��O�%@���l:��_� T�[M3����״s��ί3o�М\�2F�+P>�{�^�a���y��n�Ơ �E�D|�p�~w�ŧ����e��m����2.�mJiA҄=|8�����3S�\	�(��.���S�MÞ7�{�+�qo��^b��7�u��d2���.�@DÁ�'~���A�M�8���`4��a0�m�؍\ɲ����z�z�}�'⒅z�Hw����#0
X��:5�U�ฉ�ؠ�K2S��&�g�R0Ao�R��;�ZGZ%��IΖ1( ��k?10e�ꖘ�y���RQ�R�����٠_%D���vACa�6
�*���p D�*��������볃yE��UL��M��� ���a�-��ʾ|�4~�<`z��g!�ĥ�`�̫�N�m��At�"J����gg��QgC<L�4]
���rf�h���h�V�^g�Z�6@��`Bcyi����c�:�������kV_�a���+Wl+'H6)E�]�`�r]��\�܄�P�6{w}�[bs#��I��]�d	���w3 �����r�|%���0H�Df�Q�c�$�f����aN,�b)�o��f�<�2�xW(�=�2�SQ؆����f��`GN֊�p��(p�� ���~�L������Jq�F�t����$/՗�#�h��T��'5U��ŕ������t���'���i:SO����8�&Ӯ�Q7�p�y��T����Ѿ�kD�@��pϣ��E�1��,��n4G~����G�0{A��G��w��}d��?�g�ag�wo!�M�~�<���A�-��`���{Q����=(~�Ȭ�8��D"�c����?|�H�+�e��Sj#!6J��:JO�_�d�'�:&��|0�+��0F#���Y3�?!GS���G�X�+l9����W����b����y/�z}Ej1�̚:N�{C�)1I��4	�\hb\����b	n���l!x�Q���d�1M�s�a%ӭx�:J/�����Β/h
>.9K�����8��%;-6Q���
1��bs-G���r��/��Zm'|�Up�44���pvT�W͛JW��\\���_�Q����j���Y .���Cj�X�>|���F.]	@qS�+^�!FSJr�k�� L���9y��'�s�!1X�5�
��$��J�v�`�xD<��y^n5�\�d&���$�	4|�B������X��y���D��%<OXp]q̑�\��|��B�N�I(� ]�&Q��Uњ%���Ȗ_�^ċ����N��g��³��P��`��U�r?c�8�̰���U�9A$���΃0s3����%�!٨S��簰^��ン��(�^���7�VR�فQ�)�ŕH6�N��cCh�2E	5�'Q~p��=� ��|�p�^g��t!2x�ȠXia�A�k.�?0��|��Hvh��S�z��ȩbd��^�D�4���G�C��G�g���n�Q�r�R%�F���s�Qa�J��D�������I���@:��8�gKl
|� �2�������R.�qRz�B���ݻ�uu�p#�D]ٍ�;�譤�(W�^���¤��U
�n���y�l�Z�89��~
y�l,����d.�ɮɾ�đx�z����O�����O�wV��d���D���8�n\�:K�Œ~��N�mzr�B�`��}��ɃG?�>zՒ�8"wM�WB9aww�<J����s�=`4^�w� 8Վ)�B�ģ���A�!u�;=YNOZr ǧ���'+���3u��b��8d�~X
b��=���"z5�\_7��8��k�^"��Ԁ��&@Om�u\���d&ހ�*��B,�"�2]�!PXZi�HH�B�B�����9��?p�Q�$�>��r�/��p:�����`0��à�ݰDQ����J���]���?���r�-Rv_�3�y(�w#{(�+`UQo����. ��F�N�ޠF��d��{=+�@��n�;�ͳr8
��$^o1=_��^F}o��I8����Y)�7Bk�"�0�LP�Ӹf�X���t�	��C�Z��e�&Z�a�8�Z� q��H���Zr��i���S����� T�(Ez~��L�I�t����;U�T��X�>��D�$^���N�=���t�{�{�3�>��y�'I ��:K�@Uɒ�|u5*���v�]
o-k�d�>z��	]2�N�<�ə9���(�G�PCao�z<'��=�'IG�����إVX����V�v�,!�|ը��
k\o�ZJY�u�x��4u�f-� `  T���\d���r$22򛟘;Uq����Ģz�H8owa��[�4�G궋S��>˃N�n50�y��Mi��P[�c�~����4{�Ë��b>u��r�p�۾ YP9�����c�y�Θ5n��f}+~�춙7�+����WO%�nK��F�h�-�Y�j��1�%V�@����:x�sP��<���Xޔv)r�b0&��B���Œ�+M�md�/�l���e,"re1{�#����1ρ����`M��M��Ɏ���Ck"r���2�u<�,
Dg��t�)��/A����X��E�V��`��-�$��؛�#ݕ�i��ݺ2mi�oy��]Lwu�:/vEnP~fW>K�5:��(��0ۈ��9;pһ�o����l;�v�#�n=;�u�VrQ�O�Z���3#�;m�����e-���8��������R79T!��e�� �C	Ԓ>��=]�����C�o�*�Q���/q@#�B�*�	�I�P��4+�MA
9_e�Ы��Tf	��<^�^�\���j����[sb>�Y��#X?�;__�paQQz �s�qn~�R}�ޣ�Nͭ�G���0LWA��;�57� ��\�G�nיB���)�!y#��y�)1�=�zG:x���R���D��2M_��(�݄z�
0�����R��>N���N?��#8\��r�8�n�V��]�J�}�De�k�/v��ng)�ʤ{%j���N�U�w�.���u��:P��H����;�J|�;��rB��q���n�]�,��iVkc�.��]]=:�UB�Ŵu���u�蔊��v^v_Y�?�
8�]]F.]�HЩ��˒i���*)�Jw6:-W�v�⡵�@4��*M���١.*q��2�r4�YIjrϡݯ-pۇ���a[�`���^��U�S{
��	<�qdT�-G#�M�W�_���!e��I�Mi|ڽ��g")�-���l�N�|�?���Z�.���\����2����w�fI�����d%�R\KS:��B汯O*^���U�`��^�*{��E'�/ߕ�^Ռ�Mjp�?*����c/I�C�^~p*�ơ7Y�u�=6A0�H0���F��yM�R��:]u�ޭU�d�����~������-h���zΦŰu�lo��z���w�z���{����@�۽[x��dM*;Ve�����*�SG�v�R�-G�ج��Om@̹H�׹|i[z~Ec�D��<t�΄�`x���7��廲��/�51P��BZ\@bL�&���&J�0�������B�6�'�&��]�D���+LĢ�4�6V�D(�w���Qj����O^�������%�������<������}�
ޭ�U�O�<9y���֊9�5����h}%m��>y��{
2	���fͰ#k�g��3�rG�\��V)0W(��P�s��=�x�S�, �B��5x�������L�V!J�,y�Wu(����M+�����]�)K?�����|��`H�ve�UTC��}�i�0�(��.P�<B�H�����u�u�j�N95�|Cn�t�fq���"�Vט-]=��\�@�:�Z���"�Z�0�$� m�2����!�jhW�"eK�I��(��0>$e��������N;%G�z�ѠruJg3�ùlGh�-_�g�0��*�������#��gy��w�I%�Rr��V wO~��!p��c36��L�z��s��<NvO������-$�IrL����rmQ���rT5$��m���>�2��mju�d��@�{z�(�:��Z�x��x�Jvey��]���sot�跧����/��P�\�AUK�2���(e���LB��������S��_��Vq���W�"�>��ߨ�}?�C8����IϛL8�����7����d������s���i0���UO0�FĞ�Sv�[�b1��}�7����E�t,��`8������{9��f���?�LǷA�'�����O���b��x��?�">��Y*��v)T�-�*KK�L%�����$�%��^ |�#d&����� ��D��1�B'���Y|ڜ׏knl���[�F�r����a)r��]����|(�B�R���9��Ry9j�1�ǈ	�jaxx���gğ�U�����gw�@>���d��t?��0zH> â�d����b`$��L�x ��U(�])f�c�=��S��l;��kLYɓ(]ɟ-�^y�T>�F����{�g���KDB�'���~�0���zye��$��7q���"��˕�����s��KΠ����Y+��_����J� �v)8e�8̙�!�5Ā�C�`����A	��![g��e� ������Y�8�
��~O��dy���󠚷c�i��ݨ�,m9��U<��K w_MPw��2^�����ء�C�px�-"��HG6Y.�0^,d�(^,�?/a��B@��Z���5@�!��?����J#C}�!���~�����su���}"|�y���*�<��Y�GW�'�ث���:w-�6��s�yR+N"�v&���6��f�P*���`�v'G�_�`�E#.$�9E�b��49o��z���W5�A�|�[_��؈�6w���&�ngx4����=�)�r�
nB.��}��`!�
���9Ѓ֬���H�Z�����_�/�Y��c<`}ih3�BB&<����6E�x/yW/. <]FXdj��3�ۖ�K6FK�����S����*�H���a�)�(�`8B/RK��
Y5{�H`�!��i�X��vH�RyG��]Q�Yr4c�h�q�5 {v|��2W��U�jO5î_�ri׾����1{��1A���ر!�sQ���pWO\`2`�DK�t��n�O� s$d��7�;X��.������ė��ó��r��oA�e�uttT��)&�}ú�$��]��*N��<���1���*NZf²I��Cu)5W����i�ѡ�:"/�k������n��)J�S0Θ�+�����pxM�����+_;�GiQ�U�d�u*Y�w�#�45��h��[��4c-\k�+�y������O�W1���tgfA�1�޳?]�=�L'v᯾�thJ2��zy݉���2m��A|e�s����8]R̋I7�o���2�����C�����(��eџ�>vYL�����RY��i���m��F5�6ð���1��ֵu�c��M!$)�Z�ᵫ;Y�'L�Ϭ>�1�c�n\�������H�O/��bzqw���v��k�4W�nؾ��+����:�E��p>����.H6�۾;�௛��רo=bm=�wӘK㭌�V����g���t=��
��p7�B���	��E��9����g�kVIS��|�˼3'�:T����q͎M/��VJ� YO;�ؒB�����T�Ժ���,Uh�R} q�X��[��1�v׶�5�X��r��M�^�˥ܵ#J��4�_�Pb�5^l��V�-�t���J�}��+���I�(z(3�e� �Wߙ- �Q�Σ\��� \%��,�To�8b��d'���6[��`��"�_p�f�61KB�fb����ܽ�~J	B��F�"�B��ԜaV�6����|�;ds��n@ �����]���_��:�2�UU嬇T������uc/���/ꇜ���j�]�y�*���G��~���o��s�?���p,�TV����[��I�H�<�ŵ��j-��$���kV���Kr�~)��B���2~U�	ҧ��S�+	z%�9�5{��nɮڦ���ъ��Q&��ON�VU��M]��3ֈ�V��Ǭ˾e=6c=���5�l��Ғe_��=R�ɥ:w+Q:rR����:�UN��I�Zk�V�+�4[�,뒼eµ�֪"}�\�s&����O�V4`2k�DXE3��2D5*s�0C��q}oЇ�G��IC5��q�O����(����5��>�6R-�Ez��9���o(�����p��n8���CA�펛�CuVv�%�x�R%�ץ�ĺ jug�О���=��-�"��k%j�Y��e,��W�H��[jb���EOP�]�g�mW_�`O��H!����ȏj؛|��m���V�Zڄ6vہK&����0v��g8S��ҝ�n�i5B�I�թ��䩖Bv$��:f�f8��"�|E�6�V׵����-�Jj�u�3>�������;]"���Yo�k��Γ�Q{ك��kîp�pMg�n�!i�y"�vF]��S{�Y�g��e�p��8��� <cMw��,&���
��)�lv! �n!-���ɳL���	���ض�:���Ӏ��.�:�]8b��j^����^�>�x�=Q�u�AR���XF��x�QG��5KZ?h�k^�k�:/'8�
`(h��3mKk�۩�~�JOmV^x�7�Y碰|n6�ǐ=�t0���L�hR/��[�)�4�����|v�2���v��W"����K�<9�`6jH�]�ux�m�����������@�z-��L����-%�G�S���L��Q0�-�aE��O��^���2t]������e��V��_����y�M_�2Һ���U*����H�5&��Q������[m��OUE�R4���W��֐L�����v��M/�dd%߶�6�<�[%�Z\�#[��2s?���;���U�1P�5�F�G�w�~�UL���S�q��q	�^r��]�j��8����m
�3�-R���693��@ߊ.�G�!z^X�k���\��+���_��_�r�l�5kpB����ɼVu��L8/e)y������>IH��%9߭y��\�
���(�����{��k�Y���:�C��'|=g��K񄁡S��ht�s����h.��!1����j�,�u�^,q�����}���8!�DY���҂ +�
7?��r�581�2=���%)^>���kE���TT�Mq	�Tzt�f���?# d��'��g�v�I���j+�C��}h�ʓ#��eCZ�E$�����Ie�Վ��A�t�"L`k�e��i͹V�D���"��K��\>�0d��� �ߥ�)�R)��,�m�Tt��cH�V����|����K`z��ojd�M�Q���	�x. C$���y�����R��t)ݣG$y5/yv.,���k5<���<�֦�#$(��F�are\�C�/�JSG��R�ݡ�p&��5�\���-waO�sd@
6�g��{��Z��V~g�)��_���e����V�N�Ŝ�N���C��O����>*��j:�����.^��L��nu�m3B�1MB��:���7��k^��7,�h[��c��B�8�﮶8��� )ު(�H`@m�Mc[�C�o(ŁNb��c�5\8����+��	w�f�G�q�#F��~0�����!��h��zb�G1����'H5�x]�;[���"=�H����ʳ�-�h탫� P��Ñ��A�����=B��I8�=!�A�^�H�ٰ;�:��m����)�z��]1��c1�ө腃�?	�[Ñ��Dc����`�Oci"5����E{�h{�R�m�N2P�&�#+�`+:���G�|��"�c�>����f>����m��ڬ?��a������Pg�U��X�P�C�\�]�H�S�(d(#a�]7��!�`꺭���N� �:0�&o��Z"���-�����r��lV��_���6m��Z3_���uL`� n�z��k[�,�O��`��nU��]Y�#7��tQcT��KU��lG���n�*�������g�-M�l?s*+�T���k�oVBg����9X��VU�W7A/P�zk'!r7��}���:y��N�u�������,y����'��_�u�c߰�[R�'WG�:����ˡ�MwM���bn�XkS{���T��5^ǈ���Ze�)����Di����o	j���`U�_��Zs�<K�Vbj��`��֖�Y�����?H�Y3)��f��V�\�ģ�%�~���Ǜ�}�>�<w��f���e6��F2yA�#e���\s�Dio�T`r��� ��%��e�z��*ס��ݹ3�i��j�K4�+Eּ�kp�qRd)�BQs�Z�5�U)Э�gU����@��B�g�k�`��@	�׊�sZ1+9f��/LGC�L���0����e��>�ũdF�)�#��չL�i�֬��d���
�����d���j<�erR�I�q�ɗW���f�t��J���L��h_xhX���T!�wR�ȗe���&D��EF�->��Yj>�@T�nN\�La�8w��̓u�3����t~I�	O�-GV��# C.1-ΆI��І�֥�wE>�Ə��9�s'^ b�J+mUJ����q��E4*$)�6S_2_
�f��!�g�T��fӈ����,I��ʌF+0��4��P��"e�B"L�uG�[t�2�t�L�C8ux�k$G���'��9�0?�Rh�b��v��*(�	P�n�l�k&ж��͵X����Z)��
��e��I
�K8�44�-
x%�]��Jd醲p�m����v��iy@:��3�E�l �0���߈D�f���z(N�4��U����rJ�D�D�f0��c��ސ���?D���0d��5��\m��JIRY����u�Y\ ���6^�\�%���_���*��ڕE���<"R`� ��Z�4�����x������C�� �z�"���8���g����r���a��	Ҿ�d�e�$I.[a���p8�nu2���{|M�ɨ/&�A/�����0���;�����?�����A7�"����'�������io��|��
sr��4�"#+]Ǜ��f��p�MQ����O�2��61����պP��Y��=#�8��5�S�I�Rfs���K�[�V<{l?F���'�h�0b˘�h�,_�Kp-��t���D�FdW,H���8Ɓ���*7W����=�W�E���k$|�aIj���k<߲yQ`��`1�a�� ��ڔ�(DI�e�����hK'�9�36nU%9� �"�VY��A�f&�hT�[�0c����t��%_$ǘ�N�Z�I�H��i�}?1�p�,J�a��ۮ�a�T+i��;!�O䷧e���T�N�Y��P��*U�"���O~T'G�Tj �_d��E�:��v�t]����z<$*�O������O�9Ύ	�_�q
�ᩘ��2�jX���}�J�x%ZG�c�k{��"G�.k���.��`��Z����?O!b���<,҈_�Y��=��J�.N����)v��?O��-��H"��������?�����Yx|vpQ�|v����e�<�ox�3�-q��y������x��������eq|v�,K�� X����e�~w��ޅ ���[9�2ś|6���=xh�!_z|�'�UEKqoų�8�2�9\��wv���]á��Mq�S�eg�G�9;�f_�#Z�f�/�5lg���>U���6/�^v_]A=���Ggg��4�%sG'��X��2��x9lm�iԅR��?1� �
e=�� �A����4/�#S�� M��'�et�\��sw�<�Ek.!�gN���L��~�N$P���'�M���4:%-/�X�g;MՎ�������+,�_㈬@�K[Q~T��!]���7]U񗸸��mVB�r��Si���7�� �;��@
 57Y�Y���{4/��T�'�l��ķ��i*�Z#I&N	��A�ꗦ��["�t�-{e�f3uP��/!�{��G���"�!~���]i���دlξj6R����C[�o[چ�꽯eh�9G�G��q���>�q@J޹19���w.�OI��W] �2e��-�ݠξB&�ڊ��d�+�	�.8E_�9���|�$��n�����D�«�;�^����';x�9k������'.��7M�ZY2tH��?;K��]|��7�Ϯ����o�7{F�־��~���Y������ЦSG��3�kMŽ�Y��x	�Љ�.�Isk�d��$���߁�4X,���팄���U�(Z{�Ƌ�SY-�� ��u�
Y�tt�a6��bg3�p��1�a���R��W������nuD"�$�?,Tֹ�^����7���ɹt��
c���Ä���l3D�-KF�9� J�J�%W��IEiN�G�L�z"��ibITo.T�<@����ҕ�`4b٘��eQ8.��W�'Dү|��Ct"����J� � k��ϖ�WpM��(�`��:G�2��
����"�T(QR�axge k)k�D��S9 <���b�+Q��еe��Х�Y� �`p'� *-�6�/�s��@��ȺV+BB��0��Rө5�e���~�:���������E��4� ��Z�'�x�N��`xH�u�^90���{�`�jL�ؗ�lL����ƪ�9��ޮʪ �V���R�U�uiAum�-�m��^��@h+Ĭ������τ/�Ү|�������JT��-"���Q%��
+ X�O��������@.ls[��\DҰ�w�V��g�:����&�U�!BEV�5
*͍f(��k�Y�XA�N��V	���b�-n)��Y�Q�J����U3(��!�k�	����V蛈ևJ^��I1�f#?:3p6�r���kYoN����6a��45q�a�\�5a(k)��(Kq�Vb�����P�A��\;R���O��.�.3N\�GM1H�J]}v�(ߟ���&YBz5�FQ������Ju��t���6��07i6�μ�<���",�K$�`w�ޚ����t�Ƅ�L(K��������G��* -0+��v��B#��v�9����cI��qZ+�b�]�s��M�z�8�Tݥ4A��Bd+��d"�e=7(�J�\�#�/�*#�0%c<^ULD�Y���0wǛ�K�\�4;�	��g��+hKɥ�>+��)61h]�W���dfc�eS�
�F�r�7��#x�p���5�!��0�h��hXF�E�;�J���z��̃t�Y�=���Ԙ�X��7��m�+�k.	�෱�i�өL���>[��F���W]G���[Lf��a�{�ИÆ�x�0|������ɤ	��{vpv��VS�\��aw���j㛭<�}u�z�h�K���^�dنJ� ���k�|^}
֘�]���̭l7t��EqZ�<����5����V�&:�UI�V��ܦ��֪z��TUE1�_��TJ�n���/ӥ����1���?+�?+��x��(^k8CI�U���Z��Z�N-��W�����M}o�����$^ֹ�8�z��	;;x�	�����HɥT9�"�̺^�r#���ҡG;�4�Jտ�ɷ���=�}>��O�ͧi`��?��OS��#��{wC�������7w���5��h�L���R��H���گ�:���8u�=�}3���@�˃`�#//��C�E zC/�M����<��3�K���8?'�� ��d�6�ӔQ��.]���CM����D�����G����ޠ���������f�x�w���-�o����þǃn�������E�����Aok��%�S��ڊ��������<VT�	� ��]Ǹ�&}k�Ϗ:���ч� ��`m��� _0���I�
�:�L)5�,��f��7Ō�U6"i�5ɜ ���Q���Dʕ�c� 5%�gF�P`�����t�08蘠�5�3���1��@t�h��|��]������38�a�*��*��f�&+�B&�h,Ֆ�y?�r��N��B��M�PdW����>��.�,H�0K�\+p]re,���XRZ>�U�� Y�j��Zɭ�w��:���|�,p��HgNk���ktye(����VA�mȗG5��������22WFz��5k��"-���Ji�`9!�]����ln�\IX/.��/��� �*�<a�"фa�I(�l��8A�%�����Y��M���T.�&ޠ3��4ID��Ѷ�7����/�=o�S�_M)���.���b�v?�C�ho�d���d:���`x�d0�������Qw1�o�d�*B�k�sY����w��;n����ckU��4 D�A�9���H��\[5Vi� ���Y��)a]����\�����Kj �+/��U��Qe�Pr �CN��R*�������q�]��k���q�)w�x�67E�/��_NA���K<�n�消j=tJRMY�1�vؿ!(��2I��o S"a}A� /��<�w�_@`�2Q!�Qf?f��W
�U��%�
�`�DD+GƬC�px�-�Y �Y�y!Ma����~e�Y����q��{d'�����������]�D9��A]a�-�-���(~�*���$z.OW��*.
�ʍd�6C~�~y4�7x����on0&�Y��ȹv��|rQl���a -�{�-ъ�_��k�������Ԥ$��:�SY�(�B7Y�wL�!�����2��Vr��q�ŕ.���I�8��~~���ؔn���ϰ�O|�يvOD1��B�) ;�I��M��̪ޖ(<���T.�\Q�S�M�ꖹ1�I����Y92���ʯ�E�bh�R��Bm���(5����̷�m�ER�i��ծ���S���#��v]'�]�D;E�tS��]�fG�O�4���Z��~ӀSc������s8�UR�I�t3�XU-���$+o���o��lK���K�K�j�K��q�T$���|!�6x���Z�\���lfZހN=���õ����8"���%#J�U��aO��.�Bb���zS��_u�Wi�A"��������H� |g�TgH9Q��^.�L����N:��1���8���9\.1�`c���B� j:P�L_����bĩ�I��_�D��e䃜$2��f096:9���E(H&������\��2�Ŕ1�"�d�w���?�\�ǀQv��uL�cŮ�ۼL�S0�)Rp.1"`�� �&ڊ���O���Owp��b��"2�{��!��Y�"U����[)��<̭��5ݫ���|���w���4M7}\ 
