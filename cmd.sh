curl -X POST "https://slsp-openai-sweden.openai.azure.com/openai/deployments/datamanagement-gpt-5/chat/completions?api-version=2025-01-01-preview" \
  -H "Content-Type: application/json" \
  -H "api-key: 2e6b49d2c901420689a5ffdd6b399f90" \
  -d '{
    "model": "datamanagement-gpt-5",
    "messages": [
      {
        "role": "system",
        "content": "You are an expert document parser. Extract information from this invoice."
      },
      {
        "role": "user",
        "content": [
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/png;base64,asdasdasdasd"
            }
          }
        ]
      }
    ],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "invoice",
        "strict": true,
        "schema": {
          "type": "object",
          "properties": {
            "invoiceHeader": {
              "type": "object",
              "properties": {
                "invoiceNumber": {"type": "string"},
                "date": {"type": "string"},
                "dueDate": {"type": "string"},
                "currency": {"type": "string"},
                "totalAmount": {"type": "number"},
                "taxAmount": {"type": "number"}
              },
              "required": ["invoiceNumber","date","dueDate","currency","totalAmount","taxAmount"],
              "additionalProperties": false
            },
            "customerData": {
              "type": "object",
              "properties": {
                "name": {"type": "string"},
                "address": {"type": "string"},
                "taxId": {"type": "string"},
                "email": {"type": "string"}
              },
              "required": ["name","address","taxId","email"],
              "additionalProperties": false
            },
            "vendorData": {
              "type": "object",
              "properties": {
                "name": {"type": "string"},
                "address": {"type": "string"},
                "taxId": {"type": "string"},
                "iban": {"type": "string"}
              },
              "required": ["name","address","taxId","iban"],
              "additionalProperties": false
            },
            "invoiceRows": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "description": {"type": "string"},
                  "quantity": {"type": "number"},
                  "unitPrice": {"type": "number"},
                  "total": {"type": "number"}
                },
                "required": ["description","quantity","unitPrice","total"],
                "additionalProperties": false
              }
            }
          },
          "required": ["invoiceHeader", "customerData", "vendorData", "invoiceRows"],
          "additionalProperties": false
        }
      }
    }
  }'
