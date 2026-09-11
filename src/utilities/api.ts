export const fetchGeminiInsight = async (prompt: string, data: any) => {
    const response = await fetch('/api/ai-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, data })
    })

    if (!response.ok) {
        const errorText = await response.text()
        console.error('API response error:', response.status, errorText)
        throw new Error('Failed to get AI insight')
      }


    const result = await response.json()
    return result.text
  }
