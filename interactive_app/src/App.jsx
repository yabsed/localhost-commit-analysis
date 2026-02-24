import { useState } from 'react';
import { ActionIcon, Menu } from '@mantine/core';
import { IconCheck, IconLayoutGrid, IconMenu2, IconSwords } from '@tabler/icons-react';
import TeamBattleView from './TeamBattleView';
import TeamReviewView from './TeamReviewView';

export default function App({ colorScheme = 'light', onToggleColorScheme = () => {} }) {
  const [viewMode, setViewMode] = useState('teamReview');
  const isDarkMode = colorScheme === 'dark';

  return (
    <>
      {viewMode === 'teamReview' ? (
        <TeamReviewView
          colorScheme={colorScheme}
          onToggleColorScheme={onToggleColorScheme}
        />
      ) : (
        <TeamBattleView
          colorScheme={colorScheme}
          onToggleColorScheme={onToggleColorScheme}
        />
      )}

      <div className="view-menu-fab">
        <Menu shadow="md" width={190} position="bottom-end" withArrow>
          <Menu.Target>
            <ActionIcon
              className="view-menu-trigger"
              size={46}
              radius="xl"
              variant="filled"
              color={isDarkMode ? 'gray' : 'dark'}
              aria-label="화면 메뉴"
            >
              <IconMenu2 size={20} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>화면 전환</Menu.Label>
            <Menu.Item
              leftSection={<IconLayoutGrid size={16} />}
              rightSection={viewMode === 'teamReview' ? <IconCheck size={14} /> : null}
              onClick={() => setViewMode('teamReview')}
            >
              팀별 리뷰
            </Menu.Item>
            <Menu.Item
              leftSection={<IconSwords size={16} />}
              rightSection={viewMode === 'teamBattle' ? <IconCheck size={14} /> : null}
              onClick={() => setViewMode('teamBattle')}
            >
              팀간 배틀
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
    </>
  );
}
