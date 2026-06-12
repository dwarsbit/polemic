/**
 * StatusBar Component
 * 
 * This component displays status information at the bottom of the editor.
 */

import React from 'react';
import { FiAlertCircle, FiCheckCircle, FiEye, FiEyeOff, FiClock } from 'react-icons/fi';

interface StatusBarProps {
  stats: {
    words: number;
    characters: number;
    lines: number;
  };
  validation: {
    valid: boolean;
    errors: string[];
  };
  isSplitView: boolean;
  onToggleSplitView: () => void;
  renderTime: number;
}

const StatusBar: React.FC<StatusBarProps> = ({
  stats,
  validation,
  isSplitView,
  onToggleSplitView,
  renderTime,
}) => {
  return (
    <div className="status-bar flex items-center justify-between">
      <div className="flex items-center space-x-4">
        {/* Document Statistics */}
        <div className="flex items-center space-x-2">
          <span className="text-xs">
            Lines: {stats.lines} | Words: {stats.words} | Chars: {stats.characters}
          </span>
        </div>
        
        {/* Validation Status */}
        <div className="flex items-center space-x-1">
          {validation.valid ? (
            <FiCheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <FiAlertCircle className="w-4 h-4 text-red-500" />
          )}
          <span className="text-xs">
            {validation.valid ? 'Valid LaTeX' : `${validation.errors.length} error(s)`}
          </span>
        </div>
        
        {/* Render Time */}
        {renderTime > 0 && (
          <div className="flex items-center space-x-1">
            <FiClock className="w-4 h-4 text-gray-500" />
            <span className="text-xs">{renderTime.toFixed(0)}ms</span>
          </div>
        )}
      </div>
      
      <div className="flex items-center space-x-2">
        {/* Split View Toggle */}
        <button
          onClick={onToggleSplitView}
          className="flex items-center space-x-1 px-2 py-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-xs"
        >
          {isSplitView ? (
            <>
              <FiEye className="w-4 h-4" />
              <span>Hide Preview</span>
            </>
          ) : (
            <>
              <FiEyeOff className="w-4 h-4" />
              <span>Show Preview</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default StatusBar;
