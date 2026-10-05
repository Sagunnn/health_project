# BESAFE by AIMS

> **Before Exposure: Substance Assessment for Every Athlete**  
> *Know before you take it.*

An athlete-facing anti-doping and medication/supplement safety platform. BESAFE scans medication and supplement labels, extracts active ingredients, evaluates them contextually against the WADA Prohibited List, and maintains a private longitudinal record ("My BESAFE Passport").

---

## Key Features

- 📷 **Label Scanner:** Extracts product names and active ingredients from packaging using AI Vision.
- ⚖️ **Deterministic Rules Engine:** Separates extraction from evaluation. WADA rules are matched deterministically based on sport, route, dose, and competition timing.
- 🚦 **5-Tier Safety Classification:**
  - 🟢 **NOT PROHIBITED:** No WADA prohibition identified under specified conditions.
  - 🟡 **CONDITIONAL:** Depends on dose, route, or competition timing.
  - 🔴 **PROHIBITED:** Banned under applicable WADA rules.
  - 🟠 **SUPPLEMENT RISK:** Dietary supplement flagged for inherent unverified contamination risk.
  - ⚪ **UNVERIFIED:** Insufficient information; flagged for NADO/expert review.
- 🛂 **My BESAFE Passport:** Saves a longitudinal scan history locally on the athlete's device.
- 🎯 **Stakeholder Demo Presets:** Includes 5 instant one-click test cases (Advil, Sudafed, Stanozolol, Pre-Workout, and Herbal Extract) for demonstrations without physical packaging.

---

## Architecture

* **Input:** Camera or Label Upload
* **Phase 1 (AI OCR):** Vision LLM extracts a clean JSON payload (product name & ingredients).
* **Phase 2 (Rules Engine):** A deterministic system cross-references the extracted ingredients against the WADA Prohibited Database and the Athlete's Profile Context.
* **Output:** 5-Tier Risk Badge with Explanation, which is then saved to the local BESAFE Passport.

---

## Getting Started

### Prerequisites
- Node.js 18.17 or higher
- npm, pnpm, or yarn

### Installation

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/Sagunnn/health_project.git
   cd besafe-demo
   npm install

```

2. Configure environment variables (optional for demo):
```bash
cp .env.example .env.local

```


Add your OpenAI API key if testing live camera OCR:
```env
OPENAI_API_KEY=your_key_here

```


*(Note: The demo includes built-in mock fallbacks so you can test all 5 scenarios without an API key).*
3. Run the development server:
```bash
npm run dev

```


Open http://localhost:3000 in your browser to view the application.

---

## Deployment to Vercel

1. Push your repository to GitHub.
2. Go to Vercel (vercel.com) and click **Add New Project**.
3. Import this repository.
4. Add your `OPENAI_API_KEY` under **Environment Variables** (optional).
5. Click **Deploy**.

```

```