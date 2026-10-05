# UI/UX & Design System Guidelines for BESAFE by AIMS

## 1. The Core Vibe: "Clinical, Clean, Trustworthy"
Athletes will use this app right before consuming a substance. The UI must be unambiguous, fast, and completely free of clutter. 

## 2. App Shell (Mobile-First Constraints)
- **Container:** Wrap the entire application in a mobile-constraint container so it looks like a native iOS/Android app even on desktop. 
- **Wrapper Classes:** `max-w-md mx-auto min-h-screen bg-slate-50 shadow-2xl relative pb-20`
- **Navigation:** Implement a fixed bottom navigation bar (`fixed bottom-0 w-full max-w-md bg-white border-t border-gray-200 flex justify-around py-3 px-2 z-50`). 
- **Icons:** Use Lucide-React icons for the tabs: `ScanLine` (Scanner), `BookOpen` (Passport), `User` (Profile).

## 3. Color System
- **Primary Elements:** Interactive elements (buttons, active tabs) must use `blue-600` for a clinical, trustworthy feel.
- **The 5 Status Outcomes (STRICT):**
  - **NOT_PROHIBITED (🟢):** `bg-emerald-100 text-emerald-800 border-emerald-500` (Icon: CheckCircle)
  - **CONDITIONAL (🟡):** `bg-amber-100 text-amber-900 border-amber-500` (Icon: AlertCircle)
  - **PROHIBITED (🔴):** `bg-red-100 text-red-800 border-red-600 bg-red-50` (Icon: XOctagon)
  - **SUPPLEMENT_RISK (🟠):** `bg-orange-100 text-orange-900 border-orange-500` (Icon: AlertTriangle)
  - **UNVERIFIED (⚪):** `bg-slate-200 text-slate-800 border-slate-400` (Icon: HelpCircle)

## 4. Component Layouts
- **The Camera Button:** Make it massive and inviting. Use a large circular div: `bg-blue-600 rounded-full shadow-lg h-32 w-32 flex items-center justify-center text-white active:scale-95 transition-all`.
- **Demo Presets Menu:** Below the camera, create a clean list of 5 buttons for the investor demo presets. Style them as rounded-xl cards with subtle borders and clear typography.
- **Results Modal:** When a result is generated, it must be undeniable. The status badge must span the full width of the card. Use `text-lg font-semibold` for the plain-language explanation.
- **Passport Timeline:** Style the history list with a left-aligned vertical border to simulate a timeline (`border-l-2 border-slate-200 ml-4 pl-4 relative`).