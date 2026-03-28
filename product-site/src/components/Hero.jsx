import { motion } from 'framer-motion'
import Header from './Header'
import sentinelAiImg from '../assets/sentinel_ai.png'

function Hero() {
  return (
    <section className="hero">
      <Header />

      {/* Hero Content */}
      <div className="hero-content">
        <div className="hero-row">
          <motion.h1
            className="hero-tagline"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
          >
            Runtime Governance
            <br />
            <span className="tagline-highlight">for AI You Can Audit</span>
          </motion.h1>

          <motion.img
            src={sentinelAiImg}
            alt="Sentinel AI"
            className="hero-image"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5 }}
          />
        </div>
      </div>
    </section>
  )
}

export default Hero
