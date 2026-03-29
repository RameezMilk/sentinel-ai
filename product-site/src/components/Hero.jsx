import { motion } from 'framer-motion'
import Header from './Header'
import Architecture from './Architecture'
import sentinelAiImg from '../assets/sentinel_ai.png'

function Hero() {
  return (
    <section className="hero">
      <Header />

      {/* Hero Content */}
      <div className="hero-content">
        <div className="hero-row">
          <div className="hero-text-group">
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
            <motion.p
              className="hero-subheading"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.4 }}
            >
              Intercept, validate, and audit every AI-generated action in real time.
            </motion.p>
          </div>

          <motion.img
            src={sentinelAiImg}
            alt="Sentinel AI"
            className="hero-image"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5 }}
          />
        </div>
        <Architecture />
      </div>
    </section>
  )
}

export default Hero
