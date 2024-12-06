"use client";
import { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import {
  Send,
  Menu as MenuIcon,
  X,
  Image,
  Plus,
  History,
  Settings,
  MessageSquare,
  Trash2,
  Edit3,
} from "lucide-react";

interface ChatSession {
  id: string;
  name: string;
  messages: { role: string; content: string }[];
  sessionId: string | null;
  interactionsRemaining: number;
  isImageProcessed: boolean;
}

export default function Assistant() {
  const [query, setQuery] = useState("");
  const [currentChat, setCurrentChat] = useState<ChatSession | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<"history" | "services">("history");
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  // Initialize first session on mount
  useEffect(() => {
    const savedChats = localStorage.getItem("chatHistory");
    if (savedChats) {
      const parsedChats = JSON.parse(savedChats);
      setChatHistory(parsedChats);
      
      // If no chat exists, start a new one
      if (parsedChats.length === 0) {
        startNewChat();
      } else {
        // Load the most recent chat
        setCurrentChat(parsedChats[parsedChats.length - 1]);
      }
    } else {
      startNewChat();
    }
  }, []);

  // Scroll to bottom when messages change
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentChat?.messages]);

  // Start a new chat session
  const startNewChat = async () => {
    try {
      const sessionResponse = await fetch("https://monarch-verified-directly.ngrok-free.app/start_session", {
        method: "GET",
      });
      
      if (!sessionResponse.ok) {
        throw new Error(`HTTP error! status: ${sessionResponse.status}`);
      }

      const sessionData = await sessionResponse.json();
      
      const newChat: ChatSession = {
        id: Date.now().toString(),
        name: `Chat ${chatHistory.length + 1}`,
        messages: [],
        sessionId: sessionData.session_id,
        interactionsRemaining: 5,
        isImageProcessed: false
      };

      setChatHistory(prev => [...prev, newChat]);
      setCurrentChat(newChat);
      setSelectedImage(null);
    } catch (error) {
      console.error("Error starting new chat:", error);
    }
  };

  // Load a specific chat
  const loadChat = (id: string) => {
    const chat = chatHistory.find(c => c.id === id);
    if (chat) {
      setCurrentChat(chat);
    }
  };

  // Delete a specific chat
  const deleteChat = (id: string) => {
    setChatHistory((prev) => prev.filter((chat) => chat.id !== id));
  };

  // Rename a specific chat
  const renameChat = (id: string) => {
    const newName = prompt("Enter a new name for this chat:");
    if (newName) {
      setChatHistory((prev) =>
        prev.map((chat) =>
          chat.id === id ? { ...chat, name: newName } : chat
        )
      );
    }
  };

  // Handle Image Selection
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && !currentChat?.isImageProcessed) {
      setSelectedImage(e.target.files[0]);
    }
  };

  // Handle Image Upload
  const handleImageUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedImage || !currentChat?.sessionId) return;

    const formData = new FormData();
    formData.append("image", selectedImage);

    try {
      const imageResponse = await fetch(`https://monarch-verified-directly.ngrok-free.app/upload_image/${currentChat.sessionId}`, {
        method: "POST",
        body: formData,
      });

      if (!imageResponse.ok) {
        throw new Error(`Image upload failed with status: ${imageResponse.status}`);
      }

      const imageData = await imageResponse.json();

      const updatedChat: ChatSession = {
        ...currentChat,
        messages: [
          ...currentChat.messages,
          { role: "assistant", content: imageData.message || "Image uploaded and processed successfully." }
        ],
        isImageProcessed: true
      };

      setCurrentChat(updatedChat);
      setChatHistory(prev => 
        prev.map(chat => chat.id === updatedChat.id ? updatedChat : chat)
      );
    } catch (error) {
      console.error("Image Upload Error:", error);
      const updatedChat: ChatSession = {
        ...currentChat,
        messages: [
          ...currentChat.messages,
          { role: "assistant", content: "Sorry, there was an error uploading your image." }
        ]
      };
      setCurrentChat(updatedChat);
    }
  };

  // Handle chat submission
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !currentChat?.sessionId) return;

    // Update current chat's messages
    const updatedChat: ChatSession = {
      ...currentChat,
      messages: [...currentChat.messages, { role: "user", content: query }]
    };
    setCurrentChat(updatedChat);
    setQuery("");
    setIsLoading(true);

    try {
      const response = await fetch(`https://monarch-verified-directly.ngrok-free.app/chat/${currentChat.sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_answer: query }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Update chat with new messages and session details
      const finalUpdatedChat: ChatSession = {
        ...updatedChat,
        messages: [
          ...updatedChat.messages,
          { role: "assistant", content: data.bot_question || data.response }
        ],
        interactionsRemaining: data.interactions_remaining || updatedChat.interactionsRemaining
      };

      setCurrentChat(finalUpdatedChat);

      // Update chat history
      setChatHistory(prev => 
        prev.map(chat => chat.id === finalUpdatedChat.id ? finalUpdatedChat : chat)
      );

      // Handle final response and session reset
      if (data.is_final) {
        const finalChat: ChatSession = {
        ...finalUpdatedChat,
        messages: [
          ...finalUpdatedChat.messages,
          { role: "assistant", content: "This interaction has ended. Start a new chat to continue." }
        ]
      };
      setCurrentChat(finalChat);
    }
      
    } catch (error) { 
      console.error("Chat submission error:", error);
      const errorChat: ChatSession = {
        ...currentChat,
        messages: [
          ...currentChat.messages,
          { role: "assistant", content: "Sorry, there was an error processing your request." }
        ]
      };
      setCurrentChat(errorChat);
    } finally {
      setIsLoading(false);
    }
  };

  // Save chat history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
  }, [chatHistory]);

  return (
    <div className="flex h-screen bg-black-50">
      <div
        className={`${
          isSidebarOpen ? "w-64" : "w-0"
        } bg-black border-r transition-all duration-300 flex flex-col`}
      >
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="font-semibold text-lg">Assistant</h2>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="p-1 hover:bg-black-100 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <button
          onClick={startNewChat}
          className="m-4 p-2 bg-red-500 text-white rounded-lg flex items-center gap-2 hover:bg-red-500"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>

        <div className="flex border-b">
          <button
            onClick={() => setActiveTab("history")}
            className={`flex-1 p-3 ${
              activeTab === "history"
                ? " text-red-500"
                : "text-gray-600"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <History className="w-4 h-4" />
              History
            </div>
          </button>
          <button
            onClick={() => setActiveTab("services")}
            className={`flex-1 p-3 ${
              activeTab === "services"
                ? " text-red-500"
                : "text-gray-600"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Settings className="w-4 h-4" />
              Services
            </div>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "history" ? (
            <div className="space-y-2">
              {chatHistory.map((chat) => (
                <div
                  key={chat.id}
                  className="p-2 hover:bg-black-100 rounded cursor-pointer flex items-center justify-between"
                >
                  <div
                    onClick={() => loadChat(chat.id)}
                    className="flex items-center gap-2 flex-grow"
                  >
                    <MessageSquare className="w-4 h-4 text-red-500" />
                    <span className="text-sm">{chat.name}</span>
                  </div>
                  <div className="flex gap-2 ">
                    <button
                      onClick={() => renameChat(chat.id)}
                      className="hover:text-blue-500"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteChat(chat.id)}
                      className="hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4 " />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="p-2 hover:bg-black-100 rounded cursor-pointer">
                <h3 className="font-medium">Vehicle Diagnostics</h3>
                <p className="text-sm text-black-600">Check vehicle health</p>
              </div>
              <div className="p-2 hover:bg-black-100 rounded cursor-pointer">
                <h3 className="font-medium">Maintenance Schedule</h3>
                <p className="text-sm text-black-600">View upcoming services</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="bg-black border-b p-4 flex items-center gap-4">
          {!isSidebarOpen && (
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-1 hover:bg-black-100 rounded"
            >
              <MenuIcon className="w-5 h-5" />
            </button>
          )}
          <h1 className="font-semibold">Vehicle Assistant</h1>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {currentChat?.messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  message.role === "user"
                    ? "bg-red-500 text-black"
                    : "bg-white shadow-sm border text-black"
                }`}
              >
                {message.role === "assistant" ? (
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                ) : (
                  message.content
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start items-center space-x-4">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-red"></div>
              <div className="bg-black shadow-sm border rounded-lg p-3 text-white">
                Let&apos;s Go..
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
          {/* Interactions remaining indicator */}
          <div className="text-sm text-gray-500 text-center">
            Interactions Remaining: {currentChat?.interactionsRemaining || 0}
          </div>
        </div>

        <div className="p-4 bg-black border-t flex flex-col gap-4">
          <form onSubmit={handleImageUpload} className="flex gap-2 items-center">
            {!currentChat?.isImageProcessed ? (
              <>
                <input
                  type="file"
                  accept="image/*"
                  id="imageUpload"
                  onChange={handleImageChange}
                  className="hidden"
                />
                <label
                  htmlFor="imageUpload"
                  className={`p-2 rounded-lg cursor-pointer transition-colors flex items-center gap-2 
                    ${!selectedImage 
                      ? 'bg-blue-400 text-white' 
                      : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                >
                  <Image className="w-5 h-5" />
                  Choose File
                </label>
                {selectedImage && (
                  <button
                    type="submit"
                    className="p-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
                  >
                    <Send className="w-5 h-5" />
                    Upload Image
                  </button>
                )}
              </>
            ) : (
              <button
                type="submit"
                disabled
                className="p-2 bg-green-600 text-white rounded-lg opacity-75 cursor-not-allowed flex items-center gap-2"
              >
                <Image className="w-5 h-5" />
                Image Uploaded
              </button>
            )}
          </form>

          <form onSubmit={handleChatSubmit} className="flex gap-2 items-center">
  <input
    type="text"
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    placeholder="Ask about your vehicle..."
    className="flex-1 p-2 border rounded-lg focus:outline-none focus:border-black-500 text-black"
  />
  <button
    type="submit"
    disabled={isLoading}
    className="p-2 bg-red-500 text-white rounded-lg disabled:opacity-50 hover:bg-red-600 transition-colors"
  >
    <Send className="w-5 h-5" />
  </button>
</form>
        </div>
      </div>
    </div>
  );
}
