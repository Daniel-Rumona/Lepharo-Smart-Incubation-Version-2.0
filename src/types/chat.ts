export interface Message {
    id: string
    sender: 'user' | 'system'
    content: string
    timestamp: string
    avatar?: string
  }

  export interface ChatState {
    messages: Message[]
    isTyping: boolean
    error: string | null
    isLoading: boolean
  }

  export interface User {
    id: string
    email: string

    role?: string
  }
