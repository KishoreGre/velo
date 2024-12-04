import google.generativeai as genai
import os
from google.auth import compute_engine
from apikey import API_KEY

credentials = compute_engine.Credentials()
genai.configure(api_key=API_KEY)

model = genai.GenerativeModel('gemini-pro')
chat = model.start_chat(history=[])

vehicle_name = input("What is the vehicle? ").strip()
instruction = f"""The following are questions related to vehicle repair for the vehicle named {vehicle_name}.
                  Please ask progressively more complex questions related to the vehicle's issue, 
                  starting from general questions like model name, year made, engine type, and linking them to previous answers. 
                  The questions should be in basic english and should be small.
                  Please only ask one question at a time and wait for the user's answer."""

chat_history = []
summary = f"{vehicle_name} = "

while True:
    
    response = chat.send_message(instruction)
    bot_question = response.text.strip()

    print(f"Bot: {bot_question}")
    user_answer = input('You: ').strip()

    # Stop if the user provides an empty answer or types 'stop'
    if user_answer == '' or user_answer.lower() == 'stop':
        break

    chat_history.append(f"Bot: {bot_question}")
    chat_history.append(f"You: {user_answer}")


    instruction = f"{instruction} Previous user response: {user_answer}"
    summary += f",bot:{bot_question} user: {user_answer} "

summary += " ."

ai_summary_instruction = f"Generate a single-line summary based on the following conversation: {summary}"
ai_response = chat.send_message(ai_summary_instruction)
ai_generated_summary = ai_response.text.strip()

with open("vehicle_repair_conversation_prompt.txt", "w") as file:
    file.write(f"Detailed Summary: {summary}\n\n")
    file.write(f"AI-Generated Summary: {ai_generated_summary}\n")

print("\nConversation summary saved to 'vehicle_repair_conversation_prompt.txt'.")
