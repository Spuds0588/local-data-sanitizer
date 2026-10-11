# Product Requirements Document (PRD)

## 1. Overview
**Project Name:** Local Data Sanitizer for LLM Training (Code Name: "Scrub-Hub")
**Purpose:** A browser-based Single Page Application (SPA) designed to parse, redact, and replace Personally Identifiable Information (PII) and company secrets from documents using realistic fake data. This enables developers and "vibe coders" to safely use proprietary documents with LLM coding agents without violating AI policies or leaking sensitive data.

## 2. Target Audience
*   Developers, Data Scientists, and Product Managers building LLM-based tools.
*   Security-conscious users who cannot upload raw documents to cloud-based sanitization services.

## 3. Core Features & User Flow
1.  **File Upload:** Drag-and-drop interface supporting `.docx`, `.xlsx`, `.csv`, `.json`, and `.pdf`. Hard limit of 25MB per file to prevent browser memory crashes.
2.  **Configuration & Rules Engine:**
    *   Enable/disable standard Regex rules (Emails, Phone Numbers, SSNs, Credit Cards).
    *   Input custom keywords (e.g., "Project Phoenix", "Elon Musk") to flag company secrets.
    *   *Profile Import/Export:* Save these settings as a `rules.json` file to quickly reload future sessions.
3.  **Processing & Referential Integrity Engine:**
    *   System parses documents locally.
    *   Maintains a "Replacement Dictionary" in memory. If "John Doe" is mapped to "Mark Watney", all subsequent instances of "John Doe" map to "Mark Watney" to maintain LLM context.
4.  **Snippet Reviewer (Visual Step):**
    *   Displays a list of flagged items with surrounding context (e.g., `...account belongs to [John Smith -> Mark Watney] and...`).
    *   User can uncheck instances to ignore them, or manually override the replacement text.
5.  **Sanitization & Download:**
    *   Applies approved replacements directly to the file structures.
    *   Triggers local browser download of the sanitized files.

## 4. Scope Boundaries
*   **In Scope:** Client-side only processing, structural text replacement for DOCX/XLSX/JSON, plaintext extraction for PDF, standard PII + custom keyword flagging, Faker.js integration.
*   **Out of Scope (V1):** NLP/NER via local AI models (e.g., WebGPU), maintaining PDF visual layouts (PDFs will output as `.txt`), backend server processing, editing file metadata beyond standard contents.

---

# Implementation Guide

## 1. Architecture & Tech Stack
*   **Framework:** React 18+ via Vite (Single Page Application).
*   **Styling:** TailwindCSS (for rapid, utility-first styling without external CSS files).
*   **Hosting:** GitHub Pages (Static site, zero backend).
*   **Core Libraries:**
    *   `@faker-js/faker`: For generating deterministic or random replacement data.
    *   `jszip`: For extracting, editing, and repackaging `.docx` files.
    *   `xlsx` (SheetJS): For parsing and exporting `.xlsx` and `.csv` files.
    *   `pdfjs-dist`: For extracting text layers from `.pdf` files.

## 2. File Handling Strategy (Browser-Side)
*   **JSON:** Read as text -> `JSON.parse` -> recursively traverse keys/values -> apply regex/keywords -> `JSON.stringify` -> Export.
*   **XLSX / CSV:** Read via `xlsx` -> convert to array of objects -> iterate cells -> apply replacements -> convert back to sheet -> Export via `xlsx.writeFile`.
*   **DOCX:** Read via `jszip` -> extract `word/document.xml` -> treat as string -> run safe regex replacements (avoiding XML tags) -> update `document.xml` in zip -> Export `.docx` blob.
*   **PDF:** Read via `pdfjs-dist` -> extract text content across all pages -> run replacements on text -> Export as `.txt` file.

## 3. Data Flow & State Management
1.  **State:** `FileBlob`, `SanitizationConfig` (Regex toggles, custom keywords), `PendingReplacements` (Array of snippets), `ReplacementDictionary` (Key-Value map of Original -> Fake).
2.  **Detection Phase:** When file is loaded, scan content based on `SanitizationConfig`. For each match, check `ReplacementDictionary`. If it exists, use assigned fake value. If not, generate new fake value via Faker.js and add to dictionary.
3.  **Review Phase:** Populate UI with `PendingReplacements`. Users modifying a replacement updates the `ReplacementDictionary`.
4.  **Execution Phase:** Re-run the file parse, executing the final approved `ReplacementDictionary` against the raw file data.

## 4. Referential Integrity (The Dictionary)
Must be a Singleton or Top-Level React State.
```javascript
// Example Structure
const replacementDict = {
  "john.doe@email.com": { type: "email", fakeValue: "test.user@fakedomain.com" },
  "Project Phoenix": { type: "custom", fakeValue: "Project Alpha" }
};
```

---

# Developer Task List

### Epic 1: Scaffold & Foundation
*   [ ] **Task 1.1:** Initialize Vite React project with TailwindCSS.
*   [ ] **Task 1.2:** Set up GitHub Actions for GitHub Pages deployment.
*   [ ] **Task 1.3:** Build basic UI shell (Header, Drag & Drop zone for files, Config Sidebar).
*   [ ] **Task 1.4:** Implement 25MB file size limit validation on the drop zone.

### Epic 2: Parsing & Detection Engine
*   [ ] **Task 2.1:** Implement JSON parsing and traversal logic.
*   [ ] **Task 2.2:** Implement `.xlsx` / `.csv` parsing using SheetJS.
*   [ ] **Task 2.3:** Implement `.docx` unzipping, `word/document.xml` extraction, and re-zipping using JSZip.
*   [ ] **Task 2.4:** Implement PDF text extraction using `pdfjs-dist`.
*   [ ] **Task 2.5:** Build standard Regex detectors (Email, Phone, SSN, CC) and custom keyword detector.

### Epic 3: Referential Integrity & Faker Integration
*   [ ] **Task 3.1:** Create the `ReplacementDictionary` state manager.
*   [ ] **Task 3.2:** Wire `@faker-js/faker` to generate specific types of data based on the Regex match type (e.g., `faker.internet.email()` for emails).
*   [ ] **Task 3.3:** Ensure dictionary tracks original values to guarantee consistent replacements across the entire file.

### Epic 4: Snippet Reviewer UI
*   [ ] **Task 4.1:** Build the Review Dashboard component (List view of original snippet context + proposed replacement).
*   [ ] **Task 4.2:** Add toggle checkboxes to include/exclude specific replacements.
*   [ ] **Task 4.3:** Add inline editing for users to manually override a fake value.

### Epic 5: Execution & Export
*   [ ] **Task 5.1:** Wire the "Sanitize & Download" button to apply final dictionary to the file objects.
*   [ ] **Task 5.2:** Implement local blob generation and trigger browser download (saving PDF as `.txt`, DOCX as `.docx`, etc.).
*   [ ] **Task 5.3:** Build Config Import/Export (Save custom keywords and regex toggles to `rules.json` and read from it).

---

# agents.md

```markdown
# AI Agent Guidelines for Scrub-Hub

Welcome to the Scrub-Hub project. You are acting as an expert software developer working alongside a Product Manager. Follow these rules strictly when contributing to this codebase.

## 1. Code Generation Rules
*   **Full Files Only:** When modifying or creating code, ALWAYS output the complete file. Do not use placeholders like `// ... rest of code`. The PM must be able to copy-paste the entire code block to replace the local file seamlessly.
*   **YAGNI Principle:** "You Aren't Gonna Need It." Do not over-engineer. Do not add Redux if React Context or local state will do. Prefer one-line solutions and native Javascript functions where possible.
*   **Console Logging:** The PM relies on console logs for debugging and reporting issues back to you. Include heavily descriptive `console.log`, `console.warn`, and `console.error` statements, especially during file parsing, regex matching, and state updates. 
    *   *Example:* `console.log("[DOCX Parser] Unzipped file. Found document.xml. Length:", xmlString.length);`

## 2. Interaction & Tone
*   **Pushback:** Do not be a pushover. If the PM asks for a feature that violates browser constraints, ruins performance, or introduces massive scope creep (like rendering visual PDFs in HTML), explain why it's a bad idea and propose a viable, pragmatic alternative. 
*   **Equal Partnership:** Your goal is to deliver a functional, high-value product. Focus on engineering realities.

## 3. Project Constraints to Remember
*   **NO Backend:** This is a strictly client-side SPA. No Node.js server, no API calls to third parties. All processing happens in the browser memory.
*   **File Handling:** 
    *   `DOCX`: Edit raw XML via JSZip.
    *   `PDF`: Extract to plaintext using pdf.js, output `.txt`.
    *   `XLSX/CSV`: Use SheetJS.
*   **Referential Integrity:** "John Doe" must always become the same fake name in a single session. Always check the `ReplacementDictionary` before generating a new fake value.
```