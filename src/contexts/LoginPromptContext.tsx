import React, { createContext, useContext, useMemo, useState } from 'react'

type ClockGateState = 'checking' | 'open' | 'complete'

type LoginPromptContextValue = {
    clockGateState: ClockGateState
    setClockGateState: React.Dispatch<React.SetStateAction<ClockGateState>>
    coverageGateState: ClockGateState
    setCoverageGateState: React.Dispatch<React.SetStateAction<ClockGateState>>
}

const LoginPromptContext = createContext<LoginPromptContextValue | null>(null)

export const LoginPromptProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [clockGateState, setClockGateState] = useState<ClockGateState>('checking')
    const [coverageGateState, setCoverageGateState] = useState<ClockGateState>('checking')
    const value = useMemo(
        () => ({
            clockGateState,
            setClockGateState,
            coverageGateState,
            setCoverageGateState
        }),
        [clockGateState, coverageGateState]
    )

    return (
        <LoginPromptContext.Provider value={value}>
            {children}
        </LoginPromptContext.Provider>
    )
}

export const useLoginPrompt = () => {
    const value = useContext(LoginPromptContext)
    if (!value) throw new Error('useLoginPrompt must be used inside LoginPromptProvider')
    return value
}
