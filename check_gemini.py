import os
from dotenv import load_dotenv

load_dotenv("verifier/.env")

import google.generativeai as genai

api_key = os.environ.get("GEMINI_API_KEY", "")
if not api_key:
    print("ERROR: GEMINI_API_KEY not set in verifier/.env")
    exit(1)

genai.configure(api_key=api_key)
model = genai.GenerativeModel("gemini-2.5-flash")

response = model.generate_content("Say 'Gemini API is working!' and nothing else.")
print(response.text.strip())
