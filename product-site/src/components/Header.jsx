import { motion } from 'framer-motion'
import sentinelLogo from '../assets/sentinel_logo.png'
import Navbar from './Navbar'

function Header() {
  return (
    <motion.header
      className="header"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className="logo-container">
        <img src={sentinelLogo} alt="Sentinel AI Logo" className="logo-image" />
        <span className="logo-text">Sentinel AI</span>
      </div>
      <Navbar />
      <div className="header-spacer">
        <a
          href="https://github.com/RameezMilk/sentinel-ai"
          target="_blank"
          rel="noopener noreferrer"
          className="cta-button header-github-btn"
        >
          Github
        </a>
      </div>
    </motion.header>
  )
}

export default Header
