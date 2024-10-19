#!/bin/bash

# custom-merge-driver.sh

# Exit immediately if a command exits with a non-zero status
set -e

# Git passes these parameters to the merge driver
BASE="$1"    # %O - Ancestor's version (common base)
CURRENT="$2" # %A - Current version (ours)
OTHER="$3"   # %B - Other branch's version (theirs)

# Temporary file to store the merged result
MERGED="${CURRENT}.merged"

# Check if jq is installed
if ! command -v jq &> /dev/null
then
    echo "jq command could not be found. Please install jq to use this merge driver."
    exit 1
fi

# Optional: Validate JSON inputs
if ! jq empty "$CURRENT" 2>/dev/null; then
    echo "Invalid JSON in CURRENT file: $CURRENT"
    exit 1
fi
if ! jq empty "$OTHER" 2>/dev/null; then
    echo "Invalid JSON in OTHER file: $OTHER"
    exit 1
fi

# Create a temporary file for the jq filter
TMP_JQ_FILTER=$(mktemp /tmp/jq_filter.XXXXXX)

# Ensure the temporary file is deleted on script exit
trap 'rm -f "$TMP_JQ_FILTER"' EXIT

# Write the jq script to the temporary file
cat <<'EOF' > "$TMP_JQ_FILTER"
def mergePanelChats(ourChats; theirChats):
  (ourChats + theirChats)
  | group_by(.id)
  | map(
      if length == 1 then .[0]
      else
        .[0] as $ourChat
        | .[1] as $theirChat
        | (if ($theirChat.messages | length) > ($ourChat.messages | length) then $theirChat.messages else $ourChat.messages end) as $mergedMessages
        | ($ourChat.kv_store + $theirChat.kv_store) as $mergedKvStore
        | {
            ai_editor: $ourChat.ai_editor,
            id: $ourChat.id,
            customTitle: $ourChat.customTitle,
            parent_id: $ourChat.parent_id,
            created_on: $ourChat.created_on,
            messages: $mergedMessages,
            kv_store: $mergedKvStore
          }
      end
    );

def mergeStashedStates(ourState; theirState):
  {
    panelChats: mergePanelChats(ourState.panelChats; theirState.panelChats),
    inlineChats: (ourState.inlineChats + theirState.inlineChats | group_by(.inline_chat_id) | map(.[0])),
    schemaVersion: ourState.schemaVersion,
    deletedChats: {
      deletedMessageIDs: (ourState.deletedChats.deletedMessageIDs + theirState.deletedChats.deletedMessageIDs) | unique,
      deletedPanelChatIDs: (ourState.deletedChats.deletedPanelChatIDs + theirState.deletedChats.deletedPanelChatIDs) | unique
    },
    kv_store: (ourState.kv_store + theirState.kv_store)
  };

mergeStashedStates($ourState; $theirState)
EOF

# Debug: Verify the jq filter content
echo "Using jq filter from $TMP_JQ_FILTER:"

# Perform the merge using jq with the temporary filter file
jq -n     --argfile ourState "$CURRENT"     --argfile theirState "$OTHER"     -f "$TMP_JQ_FILTER" > "$MERGED"

# Capture jq's exit status
JQ_STATUS=$?

# Check if the merge was successful
if [ "$JQ_STATUS" -ne 0 ]; then
    echo "Error during merging stashed states."
    exit 1
fi

# Replace the current file with the merged result
mv "$MERGED" "$CURRENT"

# Indicate a successful merge
exit 0
