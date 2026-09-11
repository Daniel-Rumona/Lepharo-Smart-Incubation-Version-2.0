// LoadingBlob.tsx
import React, { useMemo } from 'react'
import { theme } from 'antd'
import { Clock, FileText, Upload, CheckCircle2 } from 'lucide-react'

interface LoadingBlobProps {
  message?: string
  progress?: number
}

export const LoadingBlob: React.FC<LoadingBlobProps> = ({
  message = 'Processing...',
  progress
}) => {
  const { token } = theme.useToken()

  // Theme-based colors so it looks native to AntD
  const colors = useMemo(() => {
    const primary = token.colorPrimary
    const primaryGlow = token.colorPrimaryHover
    const bgElevated = token.colorBgElevated
    const text = token.colorText
    const textSecondary = token.colorTextSecondary
    const mask = 'rgba(0,0,0,0.38)'
    const muted = token.colorFillSecondary
    return {
      primary,
      primaryGlow,
      bgElevated,
      text,
      textSecondary,
      mask,
      muted
    }
  }, [token])

  const css = `
  @keyframes floatUpDown {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
  }
  @keyframes spinSlow {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes pulseGlow {
    0%, 100% { opacity: 0.20; }
    50% { opacity: 0.35; }
  }
  /* orbit just eases the icon container in/out slightly */
  @keyframes orbitScale {
    0%, 100% { transform: translate(-50%, -50%) scale(1); }
    50% { transform: translate(-50%, -50%) scale(1.05); }
  }
  .lb-overlay {
    position: fixed; inset: 0; z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    background: ${colors.mask};
    backdrop-filter: blur(6px);
  }
  .lb-wrap { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px; }
  .lb-blob {
    position: relative; width: 128px; height: 128px; animation: floatUpDown 3.2s ease-in-out infinite;
  }
  .lb-ring {
    position: absolute; inset: 0; border-radius: 999px;
    background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryGlow});
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  }
  .lb-ring.r1 { opacity: .20; animation: pulseGlow 2.4s ease-in-out infinite; }
  .lb-ring.r2 { inset: 8px; opacity: .35; animation: pulseGlow 2.4s .5s ease-in-out infinite; }
  .lb-ring.r3 { inset: 16px; opacity: .95; }
  .lb-orbit {
    position: absolute; inset: 0; animation: spinSlow 12s linear infinite;
  }
  .lb-orbit.rev { animation-direction: reverse; }
  .lb-orbit .lb-sat {
    position: absolute; top: 0; left: 50%;
    transform: translate(-50%, -50%); animation: orbitScale 2.2s ease-in-out infinite;
  }
  .lb-sat-dot {
    width: 32px; height: 32px; border-radius: 999px;
    background: ${colors.bgElevated};
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 18px rgba(0,0,0,0.12);
  }
  .lb-icon { width: 16px; height: 16px; color: ${colors.primary}; }
  .lb-text { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; max-width: 520px; }
  .lb-title { font-size: 16px; font-weight: 600; color: ${colors.text}; }
  .lb-bar {
    width: 100%; max-width: 320px;
  }
  .lb-bar-track {
    width: 100%; height: 8px; border-radius: 999px; overflow: hidden; background: ${colors.muted};
  }
  .lb-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, ${colors.primary}, ${colors.primaryGlow});
    transition: width .5s ease-out;
  }
  .lb-bar-pct { margin-top: 6px; font-size: 12px; color: ${colors.textSecondary}; }
  `

  return (
    <div
      className='lb-overlay'
      role='dialog'
      aria-modal='true'
      aria-live='polite'
    >
      <style>{css}</style>

      <div className='lb-wrap'>
        {/* Blob + orbiting icons */}
        <div className='lb-blob'>
          <div className='lb-ring r1' />
          <div className='lb-ring r2' />
          <div className='lb-ring r3' />

          {/* Orbits with slight phase offsets */}
          <div className='lb-orbit'>
            <div className='lb-sat'>
              <div className='lb-sat-dot'>
                <Clock className='lb-icon' />
              </div>
            </div>
          </div>

          <div className='lb-orbit rev' style={{ animationDelay: '1s' as any }}>
            <div className='lb-sat'>
              <div className='lb-sat-dot'>
                <FileText className='lb-icon' />
              </div>
            </div>
          </div>

          <div className='lb-orbit' style={{ animationDelay: '2s' as any }}>
            <div className='lb-sat'>
              <div className='lb-sat-dot'>
                <Upload className='lb-icon' />
              </div>
            </div>
          </div>

          <div className='lb-orbit rev' style={{ animationDelay: '3s' as any }}>
            <div className='lb-sat'>
              <div className='lb-sat-dot'>
                <CheckCircle2 className='lb-icon' />
              </div>
            </div>
          </div>
        </div>

        {/* Message + progress */}
        <div className='lb-text'>
          <p className='lb-title'>{message}</p>

          {typeof progress === 'number' && (
            <div className='lb-bar'>
              <div className='lb-bar-track'>
                <div
                  className='lb-bar-fill'
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              </div>
              <p className='lb-bar-pct'>{Math.round(progress)}%</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
