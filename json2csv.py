import json
import csv
import sys

if len(sys.argv) != 3:
    print("Usage: python script.py input.json output.csv")
    sys.exit(1)

input_file = sys.argv[1]
output_file = sys.argv[2]

# Load JSON
with open(input_file, "r", encoding="utf-8") as f:
    data = json.load(f)

# Navigate to result.drawdowns
result = data.get("result")
if not isinstance(result, dict):
    print("Error: JSON must contain 'result' object")
    sys.exit(1)

drawdowns = result.get("drawdowns")
if not isinstance(drawdowns, list):
    print("Error: JSON must contain 'result.drawdowns' array")
    sys.exit(1)

# Write CSV
with open(output_file, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=drawdowns[0].keys())
    writer.writeheader()
    writer.writerows(drawdowns)

print(f"Done → {output_file}")
