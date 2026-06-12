# Polemic - Open-Source LaTeX Editor

![Polemic Logo](https://img.shields.io/badge/Polemic-LaTeX%20Editor-blue?style=for-the-badge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/dwarsbit/polemic?style=social)](https://github.com/dwarsbit/polemic)

Polemic is a modern, cross-platform, open-source LaTeX editor built with Electron, React, and TypeScript. It provides a user-friendly interface for writing, previewing, and exporting LaTeX documents with real-time preview functionality.

## Features

### Core Features
- **Syntax Highlighting**: Real-time syntax highlighting for LaTeX code
- **Live Preview**: Split-pane or side-by-side live preview of rendered LaTeX output
- **Export Options**: Export LaTeX documents to PDF, PNG, or other common formats
- **Modular Architecture**: Separate editor, preview, and export logic for maintainability

### Editor Features
- TipTap v3 based editor with LaTeX support
- Line numbers
- Auto-indentation
- LaTeX snippets and commands
- Multiple cursors and selections
- Find and replace
- Undo/Redo support

### Preview Features
- Real-time rendering using KaTeX
- Support for inline and display math
- Rendering of common LaTeX environments
- Error handling and validation

### UI/UX Features
- Clean, responsive layout with Tailwind CSS v4
- Toolbar for common LaTeX commands
- Dark/Light mode support
- Customizable themes
- Keyboard shortcuts

## Tech Stack

- **Frontend**: React (TypeScript), Tailwind CSS v4
- **Editor Core**: TipTap v3
- **Linting/Formatting**: ESLint, Prettier
- **Desktop Framework**: Electron
- **Build Tool**: Vite
- **LaTeX Rendering**: KaTeX
- **Testing**: Vitest, @testing-library/react

## Installation

### Prerequisites
- Node.js 18.0.0 or higher
- npm or yarn

### Development Setup

```bash
# Clone the repository
git clone https://github.com/dwarsbit/polemic.git
cd polemic

# Install dependencies
npm install

# Start the development server
npm run dev
```

### Building for Production

```bash
# Build the application
npm run build

# Package for all platforms
npm run package

# Package for specific platform
npm run package:win    # Windows
npm run package:mac    # macOS
npm run package:linux  # Linux
```

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + N` | Create new document |
| `Ctrl/Cmd + S` | Save document |
| `Ctrl/Cmd + O` | Open document |
| `Ctrl/Cmd + T` | Toggle theme |
| `Ctrl/Cmd + P` | Toggle preview |
| `Ctrl/Cmd + M` | Insert inline math |
| `Ctrl/Cmd + Shift + M` | Insert display math |

### Toolbar Commands

The toolbar provides quick access to common LaTeX commands:

- **File**: New, Save, Open
- **Text**: Bold, Italic, Underline, Emphasis
- **Lists**: Bullet List, Numbered List, List Item
- **Math**: Inline Math, Display Math, Fraction, Square Root, Sum, Integral
- **Structure**: Section, Subsection, Center, Quote
- **Media**: Image, Table, Figure
- **View**: Toggle Preview, Toggle Line Numbers

## Project Structure

```
polemic/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── index.ts          # Main entry point
│   │   └── preload.ts        # Preload script
│   └── renderer/             # React renderer process
│       ├── src/
│       │   ├── components/    # React components
│       │   ├── hooks/         # Custom React hooks
│       │   ├── services/      # Services (file, export, etc.)
│       │   ├── types/         # TypeScript types
│       │   ├── utils/         # Utility functions
│       │   ├── styles/        # CSS styles
│       │   ├── App.tsx        # Main App component
│       │   └── main.tsx       # Renderer entry point
│       └── index.html        # HTML template
├── public/                  # Static assets
├── dist/                    # Build outputs
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── electron-builder.yml
└── README.md
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Development server port
VITE_PORT=3000

# App title
VITE_APP_TITLE=Polemic

# KaTeX CDN URL
VITE_KATEX_CDN=https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/
```

### Customizing Themes

Themes can be customized in `src/renderer/src/hooks/useTheme.ts`. Add new themes to the `THEMES` object:

```typescript
const THEMES: Record<string, Theme> = {
  // ... existing themes
  myTheme: {
    id: 'my-theme',
    name: 'My Theme',
    isDark: true,
    colors: {
      background: '#1a1a1a',
      text: '#ffffff',
      // ... other colors
    },
  },
};
```

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add some feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed
- Keep commits atomic and well-described

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm test -- --watch
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Electron](https://www.electronjs.org/) - Cross-platform desktop applications
- [React](https://react.dev/) - JavaScript library for building user interfaces
- [TypeScript](https://www.typescriptlang.org/) - Typed JavaScript
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- [TipTap](https://tiptap.dev/) - Headless wrapper for ProseMirror
- [KaTeX](https://katex.org/) - Fast math typesetting for the web
- [Vite](https://vitejs.dev/) - Next generation frontend tooling

## Support

- [GitHub Issues](https://github.com/dwarsbit/polemic/issues) - Report bugs and request features
- [GitHub Discussions](https://github.com/dwarsbit/polemic/discussions) - Ask questions and discuss ideas

---

Built with ❤️ by [dwarsbit](https://github.com/dwarsbit)
