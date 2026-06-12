/**
 * Sidebar Component
 * 
 * This component provides a sidebar for document navigation and management.
 */

import React from 'react';
import { LaTeXDocument } from '../types';
import { FiFileText, FiPlus, FiX, FiClock, FiCalendar, FiMoreVertical } from 'react-icons/fi';

interface SidebarProps {
  documents: LaTeXDocument[];
  activeDocumentId: string;
  onSwitchDocument: (documentId: string) => void;
  onCreateDocument: () => void;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  documents,
  activeDocumentId,
  onSwitchDocument,
  onCreateDocument,
  onClose,
}) => {
  return (
    <div className="w-64 h-full bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Documents</h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={onCreateDocument}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="New Document"
          >
            <FiPlus className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Close Sidebar"
          >
            <FiX className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
      </div>
      
      {/* Documents List */}
      <div className="flex-1 overflow-auto">
        {documents.length === 0 ? (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400">
            <FiFileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No documents open</p>
            <button
              onClick={onCreateDocument}
              className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-md hover:bg-primary-600 transition-colors"
            >
              Create New Document
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {documents.map((document) => (
              <button
                key={document.id}
                onClick={() => onSwitchDocument(document.id)}
                className={`w-full p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  document.id === activeDocumentId 
                    ? 'bg-primary-50 dark:bg-primary-900/20 border-l-4 border-primary-500' 
                    : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {document.title}
                    </h3>
                    <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                      <span className="flex items-center space-x-1">
                        <FiCalendar className="w-3 h-3" />
                        <span>{formatDate(document.createdAt)}</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <FiClock className="w-3 h-3" />
                        <span>{formatDate(document.updatedAt)}</span>
                      </span>
                    </div>
                  </div>
                  <button className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    <FiMoreVertical className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </button>
                </div>
                
                {document.filePath && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">
                    {document.filePath.split('/').pop()}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* Sidebar Footer */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onCreateDocument}
          className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-primary-500 text-white rounded-md hover:bg-primary-600 transition-colors"
        >
          <FiPlus className="w-5 h-5" />
          <span>New Document</span>
        </button>
      </div>
    </div>
  );
};

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  const now = new Date();
  const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffInDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffInDays === 1) {
    return 'Yesterday';
  } else if (diffInDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else if (diffInDays < 30) {
    return Math.floor(diffInDays / 7) + 'w ago';
  } else if (diffInDays < 365) {
    return Math.floor(diffInDays / 30) + 'm ago';
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

export default Sidebar;
