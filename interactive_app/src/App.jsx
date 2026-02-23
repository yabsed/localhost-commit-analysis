import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Card,
  Checkbox,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
} from '@tabler/icons-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import {
  formatKoreanDateTime,
  formatNumber,
  processLogData,
} from './logData';

function StackedTooltip({ active, payload, label, authorByKey, unitLabel }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const normalized = payload
    .filter((item) => Number(item.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value));

  return (
    <Paper shadow="md" radius="md" p="sm" withBorder className="chart-tooltip">
      <Text fw={700} mb={6}>{label}</Text>
      <Stack gap={4}>
        {normalized.map((item) => {
          const author = authorByKey[item.dataKey];
          return (
            <Group key={`${item.dataKey}-${label}`} justify="space-between" gap="xl">
              <Group gap={8}>
                <span
                  className="swatch"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <Text size="sm">{author?.displayName ?? item.dataKey}</Text>
              </Group>
              <Text size="sm" fw={700}>{formatNumber(item.value)} {unitLabel}</Text>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}

function buildEdgeClass(type) {
  if (type === 'project') {
    return 'timeline-edge timeline-edge-project';
  }
  if (type === 'precedence') {
    return 'timeline-edge timeline-edge-precedence';
  }
  return 'timeline-edge timeline-edge-author';
}

function selectedCommitText(node) {
  if (!node) {
    return '커밋을 클릭하면 상세 정보가 표시됩니다.';
  }

  return [
    `[${node.lane?.label}]`,
    node.title,
    `${node.commitShortHash} · ${formatKoreanDateTime(node.timestampMs)}`,
  ].join(' ');
}

function buildCumulativeRows(projects, authors, nodes, subtractDeletions = false) {
  const commitRowsByProject = new Map();
  const lineRowsByProject = new Map();

  for (const project of projects) {
    const commitRow = {
      projectId: project.id,
      projectLabel: project.label,
      total: 0,
    };
    const lineRow = {
      projectId: project.id,
      projectLabel: project.label,
      total: 0,
    };

    for (const author of authors) {
      commitRow[author.key] = 0;
      lineRow[author.key] = 0;
    }

    commitRowsByProject.set(project.id, commitRow);
    lineRowsByProject.set(project.id, lineRow);
  }

  for (const node of nodes) {
    const commitRow = commitRowsByProject.get(node.projectId);
    const lineRow = lineRowsByProject.get(node.projectId);

    if (!commitRow || !lineRow || !node.authorKey) {
      continue;
    }

    commitRow[node.authorKey] += 1;
    commitRow.total += 1;

    const touchedLines = Number(node.touchedLines) || 0;
    const netLines = (Number(node.additions) || 0) - (Number(node.deletions) || 0);
    const lineValue = subtractDeletions ? netLines : touchedLines;
    lineRow[node.authorKey] += lineValue;
    lineRow.total += lineValue;
  }

  return {
    commitRows: projects.map((project) => commitRowsByProject.get(project.id)),
    lineRows: projects.map((project) => lineRowsByProject.get(project.id)),
  };
}

export default function App() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [visibleNodeCount, setVisibleNodeCount] = useState(0);
  const [subtractDeletions, setSubtractDeletions] = useState(false);
  const timelineScrollRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch('/merged_git_logs.json');
        if (!res.ok) {
          throw new Error(`데이터 로드 실패: ${res.status}`);
        }
        const data = await res.json();
        if (mounted) {
          setPayload(data);
          setError('');
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const prepared = useMemo(() => {
    if (!payload) {
      return null;
    }
    return processLogData(payload);
  }, [payload]);

  useEffect(() => {
    if (!prepared?.timeline?.nodes?.length) {
      return;
    }

    if (!selectedId) {
      setSelectedId(prepared.timeline.nodes[prepared.timeline.nodes.length - 1].id);
    }
  }, [prepared, selectedId]);

  const selectedNode = useMemo(() => {
    if (!prepared?.timeline?.nodes?.length) {
      return null;
    }

    return (
      prepared.timeline.nodes.find((node) => node.id === selectedId) ??
      prepared.timeline.nodes[prepared.timeline.nodes.length - 1]
    );
  }, [prepared, selectedId]);
  const commitRows = prepared?.commitRows ?? [];
  const lineRows = prepared?.lineRows ?? [];
  const projects = prepared?.projects ?? [];
  const authors = prepared?.authors ?? [];
  const authorByKey = prepared?.authorByKey ?? {};
  const timeline = prepared?.timeline;

  useEffect(() => {
    if (!timeline?.nodes?.length) {
      setVisibleNodeCount(0);
      return;
    }

    const scrollElement = timelineScrollRef.current;
    if (!scrollElement) {
      setVisibleNodeCount(timeline.nodes.length);
      return;
    }

    let frameId = 0;
    let ticking = false;

    const updateVisibleCount = () => {
      const viewportBottom = scrollElement.scrollTop + scrollElement.clientHeight;
      let nextCount = timeline.nodes.length;

      for (let index = 0; index < timeline.nodes.length; index += 1) {
        if (timeline.nodes[index].y > viewportBottom) {
          nextCount = index;
          break;
        }
      }

      setVisibleNodeCount((prev) => (prev === nextCount ? prev : nextCount));
    };

    const scheduleUpdate = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      frameId = window.requestAnimationFrame(() => {
        ticking = false;
        updateVisibleCount();
      });
    };

    updateVisibleCount();
    scrollElement.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      scrollElement.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [timeline]);

  const cumulativeRows = useMemo(() => {
    if (!timeline?.nodes?.length) {
      return buildCumulativeRows(projects, authors, [], subtractDeletions);
    }
    const clampedCount = Math.max(0, Math.min(visibleNodeCount, timeline.nodes.length));
    return buildCumulativeRows(projects, authors, timeline.nodes.slice(0, clampedCount), subtractDeletions);
  }, [authors, projects, timeline, visibleNodeCount, subtractDeletions]);

  const commitAxisMax = useMemo(
    () => Math.max(1, ...commitRows.map((row) => Number(row.total) || 0)),
    [commitRows]
  );

  const netLineRows = useMemo(() => {
    if (!timeline?.nodes?.length) {
      return buildCumulativeRows(projects, authors, [], true).lineRows;
    }
    return buildCumulativeRows(projects, authors, timeline.nodes, true).lineRows;
  }, [authors, projects, timeline]);

  const lineAxisDomain = useMemo(() => {
    if (!subtractDeletions) {
      const max = Math.max(1, ...lineRows.map((row) => Number(row.total) || 0));
      return [0, max];
    }

    const totals = netLineRows.map((row) => Number(row.total) || 0);
    const min = Math.min(0, ...totals);
    const max = Math.max(0, ...totals);

    if (min === max) {
      return [min - 1, max + 1];
    }

    return [min, max];
  }, [lineRows, netLineRows, subtractDeletions]);

  if (loading) {
    return (
      <div className="center-screen">
        <Loader color="teal" size="lg" />
        <Text size="sm" c="dimmed">커밋 데이터를 불러오는 중...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="center-screen">
        <Alert
          variant="light"
          color="red"
          title="오류"
          icon={<IconAlertCircle size={16} />}
        >
          {error}
        </Alert>
      </div>
    );
  }

  if (!prepared || !timeline) {
    return null;
  }

  return (
    <main className="app-shell">
      <section className="left-pane">
        <div className="pane-scroll">
          <Card className="chart-card card-enter delay-2" radius="xl" p="lg" withBorder>
            <Stack gap="xs">
              <Title order={4}>커밋 수 (프로젝트 x 작성자)</Title>
              <Text size="sm" c="dimmed">
                타임라인 스크롤 위치까지의 누적 커밋 수입니다.
              </Text>
            </Stack>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cumulativeRows.commitRows} margin={{ top: 20, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d6e3dc" />
                  <XAxis dataKey="projectLabel" />
                  <YAxis allowDecimals={false} domain={[0, commitAxisMax]} />
                  <Tooltip
                    content={
                      <StackedTooltip
                        authorByKey={authorByKey}
                        unitLabel="commit"
                      />
                    }
                  />
                  {authors.map((author) => (
                    <Bar
                      key={author.key}
                      dataKey={author.key}
                      stackId="commit"
                      fill={author.color}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="chart-card card-enter delay-3" radius="xl" p="lg" withBorder>
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap="xs">
                <Title order={4}>라인 수 (프로젝트 x 작성자)</Title>
                <Text size="sm" c="dimmed">
                  {subtractDeletions
                    ? '타임라인 스크롤 위치까지의 누적 순증가 라인(+에서 -를 뺀 값)입니다.'
                    : '타임라인 스크롤 위치까지의 누적 `+`/`-` diff 라인입니다.'}
                </Text>
              </Stack>
              <Checkbox
                size="sm"
                checked={subtractDeletions}
                onChange={(event) => setSubtractDeletions(event.currentTarget.checked)}
                label="삭제(-)를 빼서 보기"
              />
            </Group>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cumulativeRows.lineRows} margin={{ top: 20, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d6e3dc" />
                  <XAxis dataKey="projectLabel" />
                  <YAxis allowDecimals={false} domain={lineAxisDomain} />
                  {subtractDeletions && (
                    <ReferenceLine y={0} stroke="#6b7d78" strokeDasharray="4 4" />
                  )}
                  <Tooltip
                    content={
                      <StackedTooltip
                        authorByKey={authorByKey}
                        unitLabel={subtractDeletions ? 'net line' : 'line'}
                      />
                    }
                  />
                  {authors.map((author) => (
                    <Bar
                      key={author.key}
                      dataKey={author.key}
                      stackId="line"
                      fill={author.color}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

        </div>
      </section>

      <section className="right-pane">
        <Paper className="timeline-card" radius="xl" p="lg" withBorder>
          <div className="timeline-head">
            <div>
              <Title order={2}>Commit History Timeline</Title>
              <Text c="dimmed" size="sm">
                프로젝트 라인 3개 위에 시간 순 커밋을 배치하고, 선후/작성자 전환 관계를 함께 표시합니다.
              </Text>
            </div>
            <div className="edge-legend">
              <Badge variant="dot" color="gray">프로젝트 내부 흐름</Badge>
              <Badge variant="dot" color="teal">프로젝트 간 선후</Badge>
              <Badge variant="dot" color="orange">동일 작성자 전환</Badge>
            </div>
          </div>

          <Paper withBorder radius="md" p="sm" mb="sm" className="selected-commit-box">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Selected Commit</Text>
            <Text fw={700}>{selectedCommitText(selectedNode)}</Text>
            {selectedNode && (
              <Group gap="xs" mt={6}>
                <Badge color="teal" variant="light">+{formatNumber(selectedNode.additions)}</Badge>
                <Badge color="red" variant="light">-{formatNumber(selectedNode.deletions)}</Badge>
                <Badge color="gray" variant="light">{selectedNode.authorName}</Badge>
              </Group>
            )}
          </Paper>

          <div className="timeline-scroll" ref={timelineScrollRef}>
            <svg
              width={timeline.width}
              height={timeline.height}
              viewBox={`0 0 ${timeline.width} ${timeline.height}`}
              className="timeline-canvas"
              role="img"
              aria-label="Commit timeline"
            >
              <defs>
                <marker
                  id="precedence-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#0a9396" opacity="0.5" />
                </marker>
              </defs>

              {timeline.lanes.map((lane) => (
                <g key={lane.id}>
                  <line
                    x1={lane.x}
                    y1={timeline.topPadding - 30}
                    x2={lane.x}
                    y2={timeline.height - 32}
                    className="timeline-lane-line"
                  />
                  <rect
                    x={lane.x - 88}
                    y={18}
                    width={176}
                    height={34}
                    rx={12}
                    className="timeline-lane-pill"
                  />
                  <text
                    x={lane.x}
                    y={40}
                    textAnchor="middle"
                    className="timeline-lane-label"
                  >
                    {lane.label}
                  </text>
                </g>
              ))}

              {timeline.precedenceEdges.map((edge, index) => (
                <path
                  key={`precedence-${index}`}
                  d={edge.path}
                  className={buildEdgeClass('precedence')}
                  markerEnd="url(#precedence-arrow)"
                />
              ))}

              {timeline.projectEdges.map((edge, index) => (
                <path
                  key={`project-${index}`}
                  d={edge.path}
                  className={buildEdgeClass('project')}
                />
              ))}

              {timeline.authorEdges.map((edge, index) => (
                <path
                  key={`author-${index}`}
                  d={edge.path}
                  className={buildEdgeClass('author')}
                  style={{ stroke: edge.color }}
                />
              ))}

              {timeline.nodes.map((node) => {
                const isSelected = selectedNode?.id === node.id;
                return (
                  <g
                    key={node.id}
                    onClick={() => setSelectedId(node.id)}
                    className={`timeline-node ${isSelected ? 'is-selected' : ''}`}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius + 1.5}
                      className="timeline-node-ring"
                    />
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius}
                      fill={node.authorColor}
                      className="timeline-node-dot"
                    />
                    <title>
                      {`${node.authorName}\n${node.lane?.label} · ${node.commitShortHash}\n${formatKoreanDateTime(node.timestampMs)}\n+${node.additions} / -${node.deletions}\n${node.title}`}
                    </title>
                  </g>
                );
              })}
            </svg>
          </div>
        </Paper>
      </section>
    </main>
  );
}
