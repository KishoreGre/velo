import os
import json
import faiss
import torch
import PyPDF2
import google.generativeai as genai
from transformers import AutoTokenizer, AutoModel
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, CallbackContext

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

# Configure Generative AI Model
genai.configure(api_key="AIzaSyDaqVHWmp2hw0bFT3syrf5oJb3v3VVdd88")
model = genai.GenerativeModel("gemini-1.5-flash")
chat = model.start_chat(history=[])

# Embedding Model Configuration
tokenizer = AutoTokenizer.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")
embedding_model = AutoModel.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")

# Global variables
chat_history = []
MAX_INTERACTIONS = 5  # Maximum number of back-and-forth interactions
interaction_count = 0
image_processed = False  # Flag to ensure image is processed only once
image_caption = ''  # To store the image caption
vehicle_details = {}  # To store user-provided vehicle details


def imgcap(filename):
    filename = str(filename)
    myfile = genai.upload_file(f'app/images/{filename}')
    input_text = "Give a detailed description of the image, should be a summary"
    imgcap = model.generate_content([myfile, "\n\n", input_text])
    print(imgcap.text.strip())
    return imgcap.text.strip()


def generate_vehicle_description(details, image_caption):
    vehicle_type = details['vehicleType']
    vehicle_fuel_type = details['fuelType']
    vehicle_comp = details['brand']
    vehicle_name = details['model']
    vehicle_year = details['year']
    comp_name = f"{vehicle_comp}_{vehicle_name}_{vehicle_year}_{vehicle_fuel_type}"

    instruction = f"""You have been provided with specific details about a vehicle:
                        - Vehicle Type: {vehicle_type}
                        - Company: {vehicle_comp}
                        - Model: {vehicle_name}
                        - Fuel Type: {vehicle_fuel_type}
                        - Year: {vehicle_year}, with the following image description provided:
                        {image_caption}.  

                        IMPORTANT RULES:
                        For the FIRST message:
                        - Start with something related to "hello, what seems to be the issue with your {vehicle_name}? "
                        - DO NOT ask questions about details already known from the above information
                        - Ask only ONE specific question at a time
                        
                        For ALL SUBSEQUENT messages:
                        You MUST follow this EXACT format (including the empty lines and numbers):
                        [Your diagnostic question]

                        1. [First answer option]
                        2. [Second answer option]
                        3. [Third answer option]
                        4. Others: [Describe your specific situation]

                        EXAMPLE - You must follow this exact formatting:
                        What type of sound do you hear when starting the engine?

                        1. Grinding metal sound
                        2. Clicking sound
                        3. Whining sound
                        4. Others: Please describe the specific sound

                        General Rules:
                        - ALWAYS include the numbers 1-4 with the exact format shown above
                        - Options must be answers/statements, not questions
                        - Each option should be short and clear
                        - Always use "4. Others: " as the last option
                        - Progress from basic to more complex diagnostics
                        - Use simple, clear English

                        Begin by asking a precise, targeted question about the vehicle's current problem or condition."""
    
    return instruction, comp_name


# Function to handle image processing and caption generation
async def process_image(update: Update, context: CallbackContext):
    global image_processed, image_caption
    if image_processed:
        await update.message.reply_text('Image has already been processed.')
        return

    if update.message.photo:
        try:
            file = update.message.photo[-1].get_file()
            image_path = os.path.join('app', 'images', f'{file.file_id}.jpg')
            file.download(image_path)
            filename = f'{file.file_id}.jpg'
            image_caption = imgcap(filename)  # Generate image caption
            print(f"Image saved to {image_path} and processed with caption: {image_caption}")

            image_processed = True  # Set the flag to prevent re-processing
            await update.message.reply_text(f"Image uploaded and processed successfully. Caption: {image_caption}")
        except Exception as e:
            print(f"Image Upload Error: {e}")
            await update.message.reply_text('Failed to process the image.')

    else:
        await update.message.reply_text('Please send a photo.')


# Function to handle vehicle details collection
async def collect_vehicle_details(update: Update, context: CallbackContext):
    global vehicle_details

    if 'vehicleType' not in vehicle_details:
        vehicle_details['vehicleType'] = update.message.text.strip()
        await update.message.reply_text("Got it! Now, please provide the fuel type.")
        return

    if 'fuelType' not in vehicle_details:
        vehicle_details['fuelType'] = update.message.text.strip()
        await update.message.reply_text("Thank you! Now, please share the brand of your vehicle.")
        return

    if 'brand' not in vehicle_details:
        vehicle_details['brand'] = update.message.text.strip()
        await update.message.reply_text("Got it! Now, please tell me the model of your vehicle.")
        return

    if 'model' not in vehicle_details:
        vehicle_details['model'] = update.message.text.strip()
        await update.message.reply_text("Almost done! Finally, tell me the year of your vehicle.")
        return

    if 'year' not in vehicle_details:
        vehicle_details['year'] = update.message.text.strip()
        await update.message.reply_text("Great! We now have all the vehicle details.")
        return


# Function to process the user request and generate diagnostic response
async def process_request(update: Update, context: CallbackContext):
    global interaction_count, image_caption, vehicle_details
    user_answer = update.message.text.strip()

    # If vehicle details are not yet collected, prompt the user for the missing details
    if len(vehicle_details) < 5:
        await collect_vehicle_details(update, context)
        return

    # Generate vehicle description after collecting details
    instruction, comp_name = generate_vehicle_description(vehicle_details, image_caption)

    # If it's the first request (no user answer), generate initial bot question
    if not user_answer:
        response = chat.send_message(instruction)
        bot_question = response.text.strip()

        # Initialize chat history and counter
        chat_history.clear()
        interaction_count = 0
        chat_history.append({
            'role': 'bot', 
            'message': bot_question
        })

        await update.message.reply_text(f"{bot_question}\n\nIs this your first message? Yes")
        return

    # Add user's answer to chat history
    chat_history.append({
        'role': 'user', 
        'message': user_answer
    })

    # Increment interaction counter
    interaction_count += 1

    # Check if we've reached the maximum number of interactions
    if interaction_count >= MAX_INTERACTIONS:
        chat_summary = generate_chat_summary(chat_history)

        # Handle PDF processing
        folder_path = "python_Script/pdfs"
        pdf_file_path = find_pdf_by_comp_name(comp_name, folder_path)

        if pdf_file_path is None:
            await update.message.reply_text('PDF not found for the given vehicle.')
            return

        text = extract_text_from_pdf(pdf_file_path)
        chunks = split_text(text)   
        embeddings = embed_text_chunks(chunks)
        index = create_faiss_index(embeddings)

        final_response = generate_response(chat_summary, index, chunks)
        await update.message.reply_text(f"Response: {final_response.strip()}")

        return

    # Continue conversation if not yet maxed out
    instruction = f"{instruction} Previous user response: {user_answer}"
    response = chat.send_message(instruction)
    bot_question = response.text.strip()

    # Add bot's question to chat history
    chat_history.append({
        'role': 'bot', 
        'message': bot_question
    })

    await update.message.reply_text(f"{bot_question}\n\nInteractions remaining: {MAX_INTERACTIONS - interaction_count}")


# Telegram Bot Handlers
async def start(update: Update, context: CallbackContext):
    await update.message.reply_text("Welcome! Please provide your vehicle details.")


def main():
    application = Application.builder().token('YOUR_BOT_API_TOKEN').build()

    application.add_handler(CommandHandler('start', start))
    application.add_handler(MessageHandler(filters.PHOTO, process_image))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, process_request))

    application.run_polling()
# Additional functions needed for handling text processing
def generate_chat_summary(chat_history):
    return "\n".join([entry['message'] for entry in chat_history])

def find_pdf_by_comp_name(comp_name, folder_path):
    for filename in os.listdir(folder_path):
        if comp_name.lower() in filename.lower() and filename.endswith('.pdf'):
            return os.path.join(folder_path, filename)
    return None

def extract_text_from_pdf(pdf_file_path):
    with open(pdf_file_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        text = ""
        for page in reader.pages:
            text += page.extract_text()
    return text

def split_text(text, chunk_size=500):
    return [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)]

def embed_text_chunks(chunks):
    embeddings = []
    for chunk in chunks:
        inputs = tokenizer(chunk, return_tensors='pt', truncation=True, padding=True)
        with torch.no_grad():
            embeddings.append(embedding_model(**inputs).last_hidden_state.mean(dim=1).cpu().numpy())
    return embeddings

def create_faiss_index(embeddings):
    index = faiss.IndexFlatL2(embeddings[0].shape[1])  # Use L2 distance for vector similarity
    for embedding in embeddings:
        index.add(embedding)
    return index

def generate_response(chat_summary, index, chunks):
    query_embedding = tokenizer(chat_summary, return_tensors='pt', truncation=True, padding=True)
    with torch.no_grad():
        query_embedding = embedding_model(**query_embedding).last_hidden_state.mean(dim=1).cpu().numpy()

    # Perform search on the FAISS index
    _, I = index.search(query_embedding, 3)  # Retrieve top 3 closest matches
    response_text = "\n".join([chunks[i] for i in I[0]])
    return response_text

# Main entry point for the bot
def main():
    application = Application.builder().token('7689004983:AAEEbVQLO37r1eM997l-LkRZHHJ-H3vSw7I').build()

    # Adding Handlers to process different types of messages
    application.add_handler(CommandHandler('start', start))
    application.add_handler(MessageHandler(filters.PHOTO, process_image))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, process_request))

    # Start polling for new messages
    application.run_polling()

if __name__ == '__main__':
    main()
