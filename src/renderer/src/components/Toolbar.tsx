/**
 * Toolbar Component
 * 
 * This component provides a toolbar with common LaTeX commands and actions.
 */

import React from 'react';
import { LaTeXEditorResult } from '../hooks/useLaTeXEditor';
import {
  FiFile,
  FiSave,
  FiPlus,
  FiEye,
  FiEyeOff,
  FiBold,
  FiItalic,
  FiUnderline,
  FiList,
  FiType,
  FiSquare,
  FiSuperscript,
  FiSubscript,
  FiCode,
  FiImage,
  FiTable,
  FiAlignLeft,
  FiAlignCenter,
  FiAlignRight,
  FiMinus,
  FiPlusCircle,
  FiMinusCircle,
  FiDivideCircle,
  FiXCircle,
  FiCheckCircle,
} from 'react-icons/fi';

interface ToolbarProps {
  editor: LaTeXEditorResult;
  isDarkMode: boolean;
}

const Toolbar: React.FC<ToolbarProps> = ({ editor, isDarkMode }) => {
  // Toolbar button groups
  const buttonGroups = [
    {
      label: 'File',
      buttons: [
        {
          id: 'new',
          label: 'New',
          icon: <FiFile className="w-4 h-4" />,
          action: () => editor.createNewDocument(),
          shortcut: 'Ctrl+N',
        },
        {
          id: 'save',
          label: 'Save',
          icon: <FiSave className="w-4 h-4" />,
          action: () => editor.saveDocument(),
          shortcut: 'Ctrl+S',
        },
      ],
    },
    {
      label: 'Text',
      buttons: [
        {
          id: 'bold',
          label: 'Bold',
          icon: <FiBold className="w-4 h-4" />,
          action: () => editor.insertCommand('\\textbf{}'),
          shortcut: 'Ctrl+B',
        },
        {
          id: 'italic',
          label: 'Italic',
          icon: <FiItalic className="w-4 h-4" />,
          action: () => editor.insertCommand('\\textit{}'),
          shortcut: 'Ctrl+I',
        },
        {
          id: 'underline',
          label: 'Underline',
          icon: <FiUnderline className="w-4 h-4" />,
          action: () => editor.insertCommand('\\underline{}'),
          shortcut: 'Ctrl+U',
        },
        {
          id: 'emph',
          label: 'Emphasis',
          icon: <FiType className="w-4 h-4" />,
          action: () => editor.insertCommand('\\emph{}'),
        },
      ],
    },
    {
      label: 'Lists',
      buttons: [
        {
          id: 'itemize',
          label: 'Bullet List',
          icon: <FiList className="w-4 h-4" />,
          action: () => editor.insertEnvironment('itemize'),
        },
        {
          id: 'enumerate',
          label: 'Numbered List',
          icon: <FiSquare className="w-4 h-4" />,
          action: () => editor.insertEnvironment('enumerate'),
        },
        {
          id: 'item',
          label: 'List Item',
          icon: <FiMinus className="w-4 h-4" />,
          action: () => editor.insertCommand('\\item '),
        },
      ],
    },
    {
      label: 'Math',
      buttons: [
        {
          id: 'inline-math',
          label: 'Inline Math',
          icon: <FiCode className="w-4 h-4" />,
          action: () => editor.insertText('$ $', true),
          shortcut: 'Ctrl+M',
        },
        {
          id: 'display-math',
          label: 'Display Math',
          icon: <FiSuperscript className="w-4 h-4" />,
          action: () => editor.insertText('$$ $$', true),
          shortcut: 'Ctrl+Shift+M',
        },
        {
          id: 'fraction',
          label: 'Fraction',
          icon: <FiDivideCircle className="w-4 h-4" />,
          action: () => editor.insertCommand('\\frac{}{}'),
        },
        {
          id: 'sqrt',
          label: 'Square Root',
          icon: <FiXCircle className="w-4 h-4" />,
          action: () => editor.insertCommand('\\sqrt{}'),
        },
        {
          id: 'sum',
          label: 'Sum',
          icon: <FiPlusCircle className="w-4 h-4" />,
          action: () => editor.insertCommand('\\sum_{}^{} '),
        },
        {
          id: 'integral',
          label: 'Integral',
          icon: <FiMinusCircle className="w-4 h-4" />,
          action: () => editor.insertCommand('\\int_{}^{} '),
        },
      ],
    },
    {
      label: 'Structure',
      buttons: [
        {
          id: 'section',
          label: 'Section',
          icon: <FiAlignLeft className="w-4 h-4" />,
          action: () => editor.insertCommand('\\section{}'),
        },
        {
          id: 'subsection',
          label: 'Subsection',
          icon: <FiAlignCenter className="w-4 h-4" />,
          action: () => editor.insertCommand('\\subsection{}'),
        },
        {
          id: 'center',
          label: 'Center',
          icon: <FiAlignRight className="w-4 h-4" />,
          action: () => editor.insertEnvironment('center'),
        },
        {
          id: 'quote',
          label: 'Quote',
          icon: <FiCode className="w-4 h-4" />,
          action: () => editor.insertEnvironment('quote'),
        },
      ],
    },
    {
      label: 'Media',
      buttons: [
        {
          id: 'image',
          label: 'Image',
          icon: <FiImage className="w-4 h-4" />,
          action: () => editor.insertCommand('\\includegraphics{}'),
        },
        {
          id: 'table',
          label: 'Table',
          icon: <FiTable className="w-4 h-4" />,
          action: () => editor.insertEnvironment('tabular'),
        },
        {
          id: 'figure',
          label: 'Figure',
          icon: <FiImage className="w-4 h-4" />,
          action: () => editor.insertEnvironment('figure'),
        },
      ],
    },
    {
      label: 'View',
      buttons: [
        {
          id: 'preview',
          label: editor.isSplitView ? 'Hide Preview' : 'Show Preview',
          icon: editor.isSplitView ? <FiEyeOff className="w-4 h-4" /> : <FiEye className="w-4 h-4" />,
          action: () => editor.handleToggleSplitView(),
          shortcut: 'Ctrl+P',
        },
        {
          id: 'line-numbers',
          label: editor.showLineNumbers ? 'Hide Line Numbers' : 'Show Line Numbers',
          icon: editor.showLineNumbers ? <FiEyeOff className="w-4 h-4" /> : <FiEye className="w-4 h-4" />,
          action: () => editor.handleToggleLineNumbers(),
        },
      ],
    },
  ];

  return (
    <div className="flex items-center justify-between px-2 py-1 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
      {buttonGroups.map((group) => (
        <div key={group.label} className="flex items-center space-x-1 mr-4">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2 whitespace-nowrap">
            {group.label}
          </span>
          {group.buttons.map((button) => (
            <button
              key={button.id}
              onClick={button.action}
              className="toolbar-button flex items-center space-x-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              title={`${button.label}${button.shortcut ? ` (${button.shortcut})` : ''}`}
            >
              {button.icon}
              {button.shortcut && (
                <span className="text-xs opacity-50">{button.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

export default Toolbar;
