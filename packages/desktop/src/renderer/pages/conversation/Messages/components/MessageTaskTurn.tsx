import type { IMessageThinking } from '@/common/chat/chatLib';
import type { IMessageAcpToolCall, IMessageToolCall, IMessageToolGroup } from '@/common/chat/chatLib';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';
import { normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import { Spin } from '@arco-design/web-react';
import { Brain, Checklist, Right } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToolItemDetail } from './MessageToolGroupSummary';
import './MessageTaskTurn.css';

type TaskStep = { kind: 'thinking'; thinking: IMessageThinking } | { kind: 'tools'; messages: ToolMessage[] };

const ToolStepItem: React.FC<{ messages: ToolMessage[]; isOpen: boolean; onToggle: () => void }> = ({
  messages,
  isOpen,
  onToggle,
}) => {
  const tools = useMemo(() => normalizeToolMessages(messages), [messages]);
  return (
    <div className='task-turn__step'>
      <div className='task-turn__step-header' onClick={onToggle}>
        <span className='task-turn__step-icon'>
          <Checklist theme='outline' size='13' />
        </span>
        <span className='task-turn__step-label'>
          工具调用 · {messages.length}
        </span>
        <span className={`task-turn__step-arrow${isOpen ? ' task-turn__arrow--rotated' : ''}`}>
          <Right theme='outline' size='11' />
        </span>
      </div>
      {isOpen && tools.length > 0 && (
        <div className='task-turn__step-tools'>
          {tools.map((item) => (
            <ToolItemDetail key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

type MessageTaskTurnProps = {
  steps: TaskStep[];
};

const MessageTaskTurn: React.FC<MessageTaskTurnProps> = ({ steps }) => {
  const { t } = useTranslation();
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const hasRunning = steps.some((s) =>
    s.kind === 'thinking' ? s.thinking.content.status === 'thinking' : false
  );

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const sUnit = t('common.unit.second_short', { defaultValue: 's' });
    const mUnit = t('common.unit.minute_short', { defaultValue: 'm' });
    if (seconds < 60) return `${seconds}${sUnit}`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}${mUnit} ${remaining}${sUnit}`;
  };

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className='task-turn'>
      {steps.map((step, idx) => {
        if (step.kind === 'thinking') {
          const thinking = step.thinking;
          const text = thinking.content.content ?? '';
          const dur = thinking.content.duration ?? 0;
          const done = thinking.content.status === 'done';
          const isOpen = expandedSteps.has(idx);
          return (
            <div key={idx} className='task-turn__step'>
              <div className='task-turn__step-header' onClick={() => toggleStep(idx)}>
                <span className='task-turn__step-icon'>
                  {!done ? <Spin size={12} /> : <Brain theme='outline' size='13' />}
                </span>
                <span className='task-turn__step-label'>
                  {done ? `思考完成 · ${formatDuration(dur)}` : '思考中...'}
                </span>
                <span className={`task-turn__step-arrow${isOpen ? ' task-turn__arrow--rotated' : ''}`}>
                  <Right theme='outline' size='11' />
                </span>
              </div>
              {isOpen && text && (
                <div className='task-turn__step-content'>{text}</div>
              )}
            </div>
          );
        }
        const isOpen = expandedSteps.has(idx);
        return (
          <ToolStepItem
            key={idx}
            messages={step.messages}
            isOpen={isOpen}
            onToggle={() => toggleStep(idx)}
          />
        );
      })}
    </div>
  );
};

export default React.memo(MessageTaskTurn);