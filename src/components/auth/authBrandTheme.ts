import type { ThemeConfig } from 'antd'
import { useColorMode } from '@/contexts/ThemeContext'

/**
 * antd theme for the sign-in and registration screens, desktop and phone:
 * the controls on Lepharo crimson, the landing page's typeface and softer
 * corners. Used as a nested ConfigProvider, so the colour algorithm (light or
 * dark) still comes from the app-level provider.
 */
export const useAuthBrandTheme = (): ThemeConfig => {
    const { isDark } = useColorMode()

    return {
        token: {
            colorPrimary: isDark ? '#e2001a' : '#c8102e',
            colorLink: isDark ? '#ff7a86' : '#b00e29',
            borderRadius: 10,
            controlHeightLG: 46,
            fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"
        }
    }
}
