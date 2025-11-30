#!/bin/bash

BASE_URL="http://localhost:3000/api/recognize"
TEST_FILE="public/next.svg"
DOC_TYPE="invoice"

# Check if server is likely running
if ! curl -s "http://localhost:3000" > /dev/null; then
    echo "Error: Next.js server does not seem to be running at http://localhost:3000"
    echo "Please start the server with 'npm run dev' in another terminal."
    exit 1
fi

echo "------------------------------------------------"
echo "Testing Multipart/Form-Data Endpoint..."
echo "------------------------------------------------"

# We use 'gemini' because it's the default and likely configured
curl -s -X POST "$BASE_URL" \
  -F "file=@$TEST_FILE" \
  -F "docType=$DOC_TYPE" \
  -F "modelProvider=gemini" \
  | head -c 500 
# Truncating output to avoid flooding terminal if it returns a huge JSON

echo -e "\n\n------------------------------------------------"
echo "Testing Application/JSON Endpoint..."
echo "------------------------------------------------"

# Encode file to base64
if [[ "$OSTYPE" == "darwin"* ]]; then
  B64_CONTENT=$(base64 -i "$TEST_FILE")
else
  B64_CONTENT=$(base64 -w 0 "$TEST_FILE")
fi

# We need to be careful with newlines in base64 for JSON
B64_CONTENT=$(echo "$B64_CONTENT" | tr -d '\n')

# Create JSON payload
# We use a temp file for the payload to avoid command line argument limits
cat <<EOF > payload.json
{
  "file": "$B64_CONTENT",
  "mimeType": "image/svg+xml",
  "docType": "$DOC_TYPE",
  "modelProvider": "gemini"
}
EOF

curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d @payload.json \
  | head -c 500

rm payload.json
echo -e "\n\nTest Complete."
