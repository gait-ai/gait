#!/bin/bash

# custom-merge-driver.sh

# Git passes these parameters to the merge driver
BASE="$1"    # %O - Ancestor's version (common base)
CURRENT="$2" # %A - Current version (ours)
OTHER="$3"   # %B - Other branch's version (theirs)

# Temporary file to store the merged result
MERGED="$CURRENT.merged"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "jq command could not be found. Please install jq to use this merge driver."
    exit 1
fi

# Perform the merge using jq
jq -n     --argfile ourState "$CURRENT"     --argfile theirState "$OTHER"     '
def mergePanelChats(ourChats; theirChats):
  (ourChats + theirChats)
  | group_by(.id)
  | map(
      if length == 1 then .[0]
      else
        .[0] as $ourChat
        | .[1] as $theirChat
        | {
            ai_editor: $ourChat.ai_editor,
            id: $ourChat.id,
            customTitle: $ourChat.customTitle,
            parent_id: $ourChat.parent_id,
            created_on: $ourChat.created_on,
            messages: if ($theirChat.messages | length) > ($ourChat.messages | length) then $theirChat.messages else $ourChat.messages end,
            kv_store: $ourChat.kv_store + $theirChat.kv_store
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
      deletedPanelChatIDs: (ourState.deletedChats.deletedPanelChatIDs + theirState.deletedChats.deletedPanelChatIDs) | unique
    },
    kv_store: ourState.kv_store + theirState.kv_store
  };

mergeStashedStates($ourState; $theirState)
' > "$MERGED"

# Detect OS and set sed in-place edit flag accordingly
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS (BSD sed)
    SED_INPLACE=(-i '')
else
    # Assume GNU sed
    SED_INPLACE=(-i)
fi

# Debug: Verify the jq filter content
sed "${SED_INPLACE[@]}" 's/$//' "$TMP_JQ_FILTER"

# Perform the merge using jq with the temporary filter file
jq -n     --argfile ourState "$CURRENT"     --argfile theirState "$OTHER"     -f "$TMP_JQ_FILTER" > "$MERGED"

# Capture jq's exit status
JQ_STATUS=$?

# Debug: Print jq's exit status
echo "jq exit status: $JQ_STATUS"

if [ $JQ_STATUS -ne 0 ]; then
    echo "Error during merging stashed states."
    exit 1
fi

# Replace the current file with the merged result
mv "$MERGED" "$CURRENT"

# Indicate a successful merge
exit 0
