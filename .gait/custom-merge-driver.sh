#!/bin/bash

# custom-merge-driver.sh

# Git passes these parameters to the merge driver
BASE="$1"    # %O - Ancestor's version (common base)
CURRENT="$2" # %A - Current version (ours)
OTHER="$3"   # %B - Other branch's version (theirs)

# Temporary file to store the merged result
MERGED="$CURRENT.merged"

# Check if jq is installed
if ! command -v jq &> /dev/null
then
    echo "jq command could not be found. Please install jq to use this merge driver."
    exit 1
fi

# Perform the merge using jq
jq -n \
    --argfile ourState "$CURRENT" \
    --argfile theirState "$OTHER" \
    '
    def mergePanelChats(ourChats; theirChats):
        (ourChats + theirChats) | 
        group_by(.id) | 
        map(
            if length == 1 then .[0]
            else
                ourChat = .[0];
                theirChat = .[1];
                {
                    ai_editor: ourChat.ai_editor,
                    id: ourChat.id,
                    customTitle: ourChat.customTitle,
                    parent_id: ourChat.parent_id,
                    created_on: ourChat.created_on,
                    messages: if (theirChat.messages | length) > (ourChat.messages | length) then theirChat.messages else ourChat.messages end,
                    kv_store: ourChat.kv_store + theirChat.kv_store
                }
            end
        );

    def mergeStashedStates(ourState; theirState):
        {
            panelChats: mergePanelChats(ourState.panelChats; theirState.panelChats),
            inlineChats: ourState.inlineChats + theirState.inlineChats,
            schemaVersion: ourState.schemaVersion,
            deletedChats: {
                deletedMessageIDs: (ourState.deletedChats.deletedMessageIDs + theirState.deletedChats.deletedMessageIDs) | unique,
                deletedPanelChatIDs: (ourState.deletedChats.deletedPanelChatIDs + theirState.deletedPanelChatIDs) | unique
            },
            kv_store: ourState.kv_store + theirState.kv_store
        };

    ourState = $ourState;
    theirState = $theirState;

    mergedState = mergeStashedStates(ourState; theirState);

    mergedState
    ' > "$MERGED"

# Check if the merge was successful
if [ $? -ne 0 ]; then
    echo "Error during merging stashed states."
    exit 1
fi

# Replace the current file with the merged result
mv "$MERGED" "$CURRENT"

# Indicate a successful merge
exit 0
