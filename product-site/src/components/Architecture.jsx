import { motion } from 'framer-motion'

const steps = [
  {
    label: 'Dev Prompt',
    sub: 'User message to Copilot',
  },
  {
    label: 'Intent Screen',
    sub: 'Blocked before generation',
  },
  {
    label: 'Copilot Generates',
    sub: 'Code or shell command',
  },
  {
    label: 'Regex + Policy Gate',
    sub: 'Dual-layer risk scan',
  },
  {
    label: 'Approve / Deny',
    sub: 'Human-in-the-loop',
  },
  {
    label: 'Audit Log',
    sub: 'Immutable on Solana',
  },
]

function Arrow() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="none" className="arch-arrow">
      <line x1="0" y1="8" x2="20" y2="8" stroke="rgba(55,55,62,0.9)" strokeWidth="2" />
      <polygon points="20,3 28,8 20,13" fill="rgba(55,55,62,0.9)" />
    </svg>
  )
}

export default function Architecture() {
  return (
    <div className="arch-wrapper">
      <motion.h2
        className="arch-heading"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.6 }}
      >
        How It Works
      </motion.h2>
      <motion.div
        className="arch-container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.7 }}
      >
      {steps.map((step, i) => (
        <div key={step.label} className="arch-step">
          <motion.div
            className="arch-card"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.8 + i * 0.1 }}
          >
            <span className="arch-label">{step.label}</span>
            <span className="arch-sub">{step.sub}</span>
          </motion.div>
          {i < steps.length - 1 && <Arrow />}
        </div>
      ))}
    </motion.div>
    </div>
  )
}
