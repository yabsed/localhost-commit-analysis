import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  Paper,
  Slider,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconMoon, IconSun } from '@tabler/icons-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatKoreanDateTime, formatNumber, processLogData } from './logData';

const DEFAULT_IDENTITY_RULES_TEXT = 'Seo Minseok - user983740';
const DEFAULT_IDENTITY_RULES_FILE = 'author_identity_rules.txt';
const IDENTITY_RULES_STORAGE_KEY = 'wackathon-identity-rules';
const DEFAULT_TOP_LONG_COMMIT_PERCENT = 15;
const STATIC_DATA_MANIFEST_PATH = 'data/manifest.json';
const IS_STATIC_BUILD = import.meta.env.PROD;

const TEAM_BASE_COLORS = [
  '#1d4ed8',
  '#dc2626',
  '#0f766e',
  '#9333ea',
  '#ca8a04',
  '#0891b2',
  '#be123c',
  '#475569',
  '#ea580c',
  '#15803d',
  '#7c2d12',
  '#334155',
];

function resolveAppAssetUrl(relativePath) {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = String(relativePath || '').replace(/^\/+/, '');
  return `${normalizedBase}${normalizedPath}`;
}

async function fetchStaticDataManifest() {
  const res = await fetch(resolveAppAssetUrl(STATIC_DATA_MANIFEST_PATH));
  if (!res.ok) {
    throw new Error(`정적 데이터 manifest 로드 실패: ${res.status}`);
  }
  return res.json();
}

function normalizeFileEntries(items, extension) {
  const files = Array.isArray(items) ? items : [];
  return files
    .map((item) => ({
      name: typeof item?.name === 'string' ? item.name : '',
      sizeBytes: Number(item?.sizeBytes) || 0,
      modifiedAtMs: Number(item?.modifiedAtMs) || 0,
      path: typeof item?.path === 'string' ? item.path : null,
    }))
    .filter((item) => item.name && item.name.endsWith(extension))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function teamIdFromFileName(fileName = '') {
  return String(fileName).replace(/\.json$/i, '').trim() || 'unknown-team';
}

function withAlpha(hexColor, alpha = 1) {
  const source = String(hexColor || '').trim();
  const expanded = source.length === 4
    ? `#${source[1]}${source[1]}${source[2]}${source[2]}${source[3]}${source[3]}`
    : source;
  const matched = /^#?([0-9a-f]{6})$/i.exec(expanded);
  if (!matched) {
    return hexColor;
  }
  const raw = matched[1];
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function readStoredIdentityRulesText() {
  if (typeof window === 'undefined') {
    return '';
  }
  return String(window.localStorage.getItem(IDENTITY_RULES_STORAGE_KEY) || '').trim();
}

function splitIdentityRuleLine(line) {
  const source = String(line || '').trim();
  if (!source || source.startsWith('#')) {
    return null;
  }

  const splitBy = (delimiter) => {
    const index = source.indexOf(delimiter);
    if (index < 0) {
      return null;
    }
    const left = source.slice(0, index).trim();
    const right = source.slice(index + delimiter.length).trim();
    if (!left || !right) {
      return null;
    }
    return [left, right];
  };

  return (
    splitBy('->')
    ?? splitBy(' - ')
    ?? splitBy(',')
    ?? splitBy('\t')
    ?? (() => {
      const firstDash = source.indexOf('-');
      const lastDash = source.lastIndexOf('-');
      if (firstDash <= 1 || firstDash !== lastDash || firstDash >= source.length - 2) {
        return null;
      }
      const left = source.slice(0, firstDash).trim();
      const right = source.slice(firstDash + 1).trim();
      if (left.length < 2 || right.length < 2) {
        return null;
      }
      return [left, right];
    })()
  );
}

function parseIdentityRules(rawText = '') {
  const lines = String(rawText || '').split('\n');
  const pairs = [];
  const invalidLines = [];

  lines.forEach((line, index) => {
    const source = String(line || '').trim();
    if (!source || source.startsWith('#')) {
      return;
    }

    const pair = splitIdentityRuleLine(source);
    if (!pair) {
      invalidLines.push({ lineNumber: index + 1, value: source });
      return;
    }
    pairs.push(pair);
  });

  return {
    pairs,
    invalidLines,
  };
}

async function loadDefaultIdentityRulesText() {
  if (IS_STATIC_BUILD) {
    const manifest = await fetchStaticDataManifest();
    const files = normalizeFileEntries(manifest?.identityRuleFiles, '.txt');
    const selectedFile = files.find((item) => item.name === DEFAULT_IDENTITY_RULES_FILE) ?? files[0];
    if (!selectedFile?.path) {
      return DEFAULT_IDENTITY_RULES_TEXT;
    }
    const res = await fetch(resolveAppAssetUrl(selectedFile.path));
    if (!res.ok) {
      throw new Error(`규칙 파일 로드 실패: ${res.status}`);
    }
    return res.text();
  }

  const res = await fetch(`/api/identity-rule-file?file=${encodeURIComponent(DEFAULT_IDENTITY_RULES_FILE)}`);
  if (!res.ok) {
    throw new Error(`규칙 파일 로드 실패: ${res.status}`);
  }
  return res.text();
}

function trendDelta(node, metric, subtractDeletions = false) {
  if (metric === 'commits') {
    return 1;
  }
  return subtractDeletions
    ? (Number(node.additions) || 0) - (Number(node.deletions) || 0)
    : Number(node.touchedLines) || 0;
}

function commitLength(node) {
  const touched = Number(node.touchedLines);
  if (Number.isFinite(touched) && touched >= 0) {
    return touched;
  }
  return (Number(node.additions) || 0) + (Number(node.deletions) || 0);
}

function buildTopLongestCommitIdSet(nodes, topPercent = 0.1) {
  if (!Array.isArray(nodes) || nodes.length === 0 || topPercent <= 0) {
    return new Set();
  }

  const byRepo = new Map();
  for (const node of nodes) {
    const repoId = node.repoId ?? '__unknown_repo__';
    if (!byRepo.has(repoId)) {
      byRepo.set(repoId, []);
    }
    byRepo.get(repoId).push(node);
  }

  const excludedIds = new Set();
  for (const repoNodes of byRepo.values()) {
    const removeCount = Math.ceil(repoNodes.length * topPercent);
    if (removeCount <= 0) {
      continue;
    }

    const ranked = repoNodes
      .map((node) => ({
        id: node.id,
        length: commitLength(node),
        timestampMs: Number(node.timestampMs) || 0,
      }))
      .sort((a, b) => (
        b.length - a.length
        || b.timestampMs - a.timestampMs
        || String(a.id).localeCompare(String(b.id))
      ));

    for (const item of ranked.slice(0, removeCount)) {
      excludedIds.add(item.id);
    }
  }

  return excludedIds;
}

function buildZeroLengthCommitIdSet(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return new Set();
  }

  const excludedIds = new Set();
  for (const node of nodes) {
    if (commitLength(node) === 0) {
      excludedIds.add(node.id);
    }
  }
  return excludedIds;
}

function pickDisplayName(nameCountMap) {
  let bestName = 'Unknown';
  let bestCount = -1;
  for (const [name, count] of nameCountMap.entries()) {
    if (count > bestCount) {
      bestName = name;
      bestCount = count;
    }
  }
  return bestName;
}

function pickTopMapKey(countMap, fallbackValue = null) {
  let topKey = fallbackValue;
  let topValue = -1;
  for (const [key, value] of countMap.entries()) {
    const score = Number(value) || 0;
    if (score > topValue) {
      topKey = key;
      topValue = score;
    }
  }
  return topKey;
}

function pickUserStrokeByTeam(baseColor, orderInTeam) {
  const alphaSteps = [0.68, 0.58, 0.48, 0.4, 0.34, 0.28];
  const alpha = alphaSteps[orderInTeam % alphaSteps.length];
  return withAlpha(baseColor, alpha);
}

function buildPreparedTeamBattle(teamPayloads, identityPairs = []) {
  if (!Array.isArray(teamPayloads) || teamPayloads.length === 0) {
    return {
      nodes: [],
      teams: [],
      teamTotalSeries: [],
      authorSeries: [],
      authorKeyById: new Map(),
    };
  }

  const teamOrder = [];
  const teamById = new Map();
  const nodes = [];
  const authorStatsById = new Map();

  for (const teamPayload of teamPayloads) {
    const teamId = teamIdFromFileName(teamPayload.fileName);
    if (!teamById.has(teamId)) {
      teamById.set(teamId, {
        id: teamId,
        label: teamId,
      });
      teamOrder.push(teamId);
    }

    const prepared = processLogData(teamPayload.payload, { identityPairs });

    for (const node of prepared.timeline?.nodes ?? []) {
      const repoId = `${teamId}::${node.projectId}`;
      const transformed = {
        id: `${teamId}:${node.id}`,
        teamId,
        repoId,
        projectId: repoId,
        timestampMs: Number(node.timestampMs) || 0,
        sourceOrder: Number(node.sourceOrder) || 0,
        sourceCommitIndex: Number(node.sourceCommitIndex) || 0,
        additions: Number(node.additions) || 0,
        deletions: Number(node.deletions) || 0,
        touchedLines: Number(node.touchedLines) || 0,
        authorId: String(node.authorId || 'unknown-author'),
        authorName: String(node.authorName || node.authorFallbackName || 'Unknown'),
      };
      nodes.push(transformed);

      if (!authorStatsById.has(transformed.authorId)) {
        authorStatsById.set(transformed.authorId, {
          id: transformed.authorId,
          commits: 0,
          lines: 0,
          names: new Map(),
          teamCounts: new Map(),
        });
      }
      const authorStats = authorStatsById.get(transformed.authorId);
      authorStats.commits += 1;
      authorStats.lines += transformed.touchedLines;
      authorStats.names.set(
        transformed.authorName,
        (authorStats.names.get(transformed.authorName) ?? 0) + 1
      );
      authorStats.teamCounts.set(
        transformed.teamId,
        (authorStats.teamCounts.get(transformed.teamId) ?? 0) + 1
      );
    }
  }

  const teamIndexMap = new Map(teamOrder.map((teamId, index) => [teamId, index]));
  nodes.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) {
      return a.timestampMs - b.timestampMs;
    }
    const teamDiff = (teamIndexMap.get(a.teamId) ?? 0) - (teamIndexMap.get(b.teamId) ?? 0);
    if (teamDiff !== 0) {
      return teamDiff;
    }
    if (a.sourceOrder !== b.sourceOrder) {
      return a.sourceOrder - b.sourceOrder;
    }
    if (a.sourceCommitIndex !== b.sourceCommitIndex) {
      return a.sourceCommitIndex - b.sourceCommitIndex;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  const teams = teamOrder.map((teamId, index) => ({
    ...teamById.get(teamId),
    color: TEAM_BASE_COLORS[index % TEAM_BASE_COLORS.length],
  }));

  const teamColorById = new Map(teams.map((team) => [team.id, team.color]));

  const teamTotalSeries = teams.map((team, index) => ({
    id: team.id,
    key: `team_total_${index}`,
    teamId: team.id,
    label: `${team.label} 합계`,
    stroke: team.color,
    strokeWidth: 2,
    opacity: 1,
    isTeamTotal: true,
  }));

  const sortedAuthors = [...authorStatsById.values()]
    .map((author) => ({
      id: author.id,
      displayName: pickDisplayName(author.names),
      commits: author.commits,
      lines: author.lines,
      dominantTeamId: pickTopMapKey(author.teamCounts, teamOrder[0] ?? null),
    }))
    .sort((a, b) => (
      b.commits - a.commits
      || b.lines - a.lines
      || a.displayName.localeCompare(b.displayName)
    ));
  const colorOrderByTeam = new Map();
  const authorSeries = sortedAuthors.map((author, index) => {
      const teamId = author.dominantTeamId;
      const orderInTeam = colorOrderByTeam.get(teamId) ?? 0;
      colorOrderByTeam.set(teamId, orderInTeam + 1);
      const teamColor = teamColorById.get(teamId) ?? '#64748b';

      return {
        id: author.id,
        key: `author_${index}`,
        teamId,
        label: author.displayName,
        stroke: pickUserStrokeByTeam(teamColor, orderInTeam),
        strokeWidth: 1.1,
        opacity: 0.95,
        isTeamTotal: false,
      };
    });

  const authorKeyById = new Map(authorSeries.map((author) => [author.id, author.key]));

  return {
    nodes,
    teams,
    teamTotalSeries,
    authorSeries,
    authorKeyById,
  };
}

function buildTeamRows(
  nodes,
  teamTotalSeries,
  metric,
  subtractDeletions = false,
  showPercent = false,
  excludedCommitIds = null
) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const totalsByTeamId = Object.fromEntries(teamTotalSeries.map((series) => [series.id, 0]));

  return nodes.map((node, index) => {
    if (!excludedCommitIds?.has(node.id)) {
      const delta = trendDelta(node, metric, subtractDeletions);
      if (Object.prototype.hasOwnProperty.call(totalsByTeamId, node.teamId)) {
        totalsByTeamId[node.teamId] += delta;
      }
    }

    const row = {
      index,
      timestampMs: Number(node.timestampMs) || 0,
      label: formatKoreanDateTime(node.timestampMs),
    };

    if (!showPercent) {
      for (const series of teamTotalSeries) {
        row[series.key] = Number(totalsByTeamId[series.id]) || 0;
      }
      return row;
    }

    const denominator = teamTotalSeries.reduce(
      (sum, series) => sum + Math.abs(Number(totalsByTeamId[series.id]) || 0),
      0
    );

    for (const series of teamTotalSeries) {
      const value = Number(totalsByTeamId[series.id]) || 0;
      row[series.key] = denominator > 0 ? (value / denominator) * 100 : 0;
    }

    return row;
  });
}

function buildAuthorRows(
  nodes,
  authorSeries,
  authorKeyById,
  metric,
  subtractDeletions = false,
  showPercent = false,
  excludedCommitIds = null
) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const totalsByAuthorKey = Object.fromEntries(authorSeries.map((series) => [series.key, 0]));

  return nodes.map((node, index) => {
    if (!excludedCommitIds?.has(node.id)) {
      const delta = trendDelta(node, metric, subtractDeletions);
      const authorKey = authorKeyById.get(node.authorId);
      if (authorKey && Object.prototype.hasOwnProperty.call(totalsByAuthorKey, authorKey)) {
        totalsByAuthorKey[authorKey] += delta;
      }
    }

    const row = {
      index,
      timestampMs: Number(node.timestampMs) || 0,
      label: formatKoreanDateTime(node.timestampMs),
    };

    if (!showPercent) {
      for (const series of authorSeries) {
        row[series.key] = Number(totalsByAuthorKey[series.key]) || 0;
      }
      return row;
    }

    const denominator = authorSeries.reduce(
      (sum, series) => sum + Math.abs(Number(totalsByAuthorKey[series.key]) || 0),
      0
    );

    for (const series of authorSeries) {
      const value = Number(totalsByAuthorKey[series.key]) || 0;
      row[series.key] = denominator > 0 ? (value / denominator) * 100 : 0;
    }

    return row;
  });
}

function buildDomain(rows, series, showPercent) {
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(series) || series.length === 0) {
    return showPercent ? [-100, 100] : [0, 1];
  }

  const values = rows.flatMap((row) => series.map((item) => Number(row[item.key]) || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (showPercent) {
    const boundedMin = Math.min(0, min);
    const boundedMax = Math.max(0, max);
    if (boundedMin === boundedMax) {
      return [boundedMin - 1, boundedMax + 1];
    }
    return [boundedMin, boundedMax];
  }

  if (min === max) {
    return [min - 1, max + 1];
  }
  return [min, max];
}

function toNumericInputValue(rawValue) {
  if (rawValue === '' || rawValue === null || rawValue === undefined) {
    return '';
  }
  return String(rawValue);
}

export default function TeamBattleView({ colorScheme = 'light', onToggleColorScheme = () => {} }) {
  const [teamPayloads, setTeamPayloads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fileListLoading, setFileListLoading] = useState(true);
  const [refreshingFileList, setRefreshingFileList] = useState(false);
  const [error, setError] = useState('');
  const [identityRuleError, setIdentityRuleError] = useState('');
  const [identityRulesText, setIdentityRulesText] = useState(
    () => readStoredIdentityRulesText() || DEFAULT_IDENTITY_RULES_TEXT
  );
  const [logFiles, setLogFiles] = useState([]);

  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [metricMode, setMetricMode] = useState('commits');
  const [showProjectPercent, setShowProjectPercent] = useState(false);
  const [excludeTopLongCommits, setExcludeTopLongCommits] = useState(false);
  const [excludeZeroLengthCommit, setExcludeZeroLengthCommit] = useState(false);
  const [subtractDeletions, setSubtractDeletions] = useState(false);
  const [topLongCommitPercentInput, setTopLongCommitPercentInput] = useState(
    String(DEFAULT_TOP_LONG_COMMIT_PERCENT)
  );
  const [activeTrendIndex, setActiveTrendIndex] = useState(null);

  const identityRules = useMemo(
    () => parseIdentityRules(identityRulesText),
    [identityRulesText]
  );

  const isDarkMode = colorScheme === 'dark';
  const actionButtonColor = isDarkMode ? 'gray' : 'dark';
  const chartGridStroke = isDarkMode ? '#474b57' : '#d3d3d3';
  const chartReferenceStroke = isDarkMode ? '#7e8694' : '#8f8f8f';

  const loadLogFiles = useCallback(async ({ manual = false } = {}) => {
    if (manual) {
      setRefreshingFileList(true);
    } else {
      setFileListLoading(true);
    }

    try {
      let files = [];
      if (IS_STATIC_BUILD) {
        const manifest = await fetchStaticDataManifest();
        files = normalizeFileEntries(manifest?.commitLogs, '.json');
      } else {
        const res = await fetch('/api/commit-logs');
        if (!res.ok) {
          throw new Error(`파일 목록 로드 실패: ${res.status}`);
        }
        const data = await res.json();
        files = normalizeFileEntries(data?.files, '.json');
      }

      setLogFiles(files);
      if (files.length === 0) {
        setTeamPayloads([]);
        setError(
          IS_STATIC_BUILD
            ? '선택 가능한 JSON 파일이 없습니다. build 전에 `npm run prepare:data`를 실행하세요.'
            : '선택 가능한 JSON 파일이 없습니다. commit_crawler/json을 확인하세요.'
        );
      } else {
        setError('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (manual) {
        setRefreshingFileList(false);
      } else {
        setFileListLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadLogFiles();
  }, [loadLogFiles]);

  useEffect(() => {
    let mounted = true;
    async function loadRules() {
      try {
        const storedRules = readStoredIdentityRulesText();
        if (storedRules) {
          if (!mounted) {
            return;
          }
          setIdentityRulesText(storedRules);
          setIdentityRuleError('');
          return;
        }

        const text = await loadDefaultIdentityRulesText();
        if (!mounted) {
          return;
        }
        setIdentityRulesText(text);
        setIdentityRuleError('');
      } catch (err) {
        if (!mounted) {
          return;
        }
        setIdentityRulesText(DEFAULT_IDENTITY_RULES_TEXT);
        setIdentityRuleError(err instanceof Error ? err.message : String(err));
      }
    }

    loadRules();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(IDENTITY_RULES_STORAGE_KEY, identityRulesText);
  }, [identityRulesText]);

  useEffect(() => {
    if (!logFiles.length) {
      setLoading(false);
      return;
    }

    let mounted = true;
    async function loadAllTeamPayloads() {
      try {
        setLoading(true);

        const loaded = await Promise.all(logFiles.map(async (file) => {
          let res;
          if (IS_STATIC_BUILD) {
            if (!file.path) {
              throw new Error(`${file.name}: 정적 경로가 없습니다.`);
            }
            res = await fetch(resolveAppAssetUrl(file.path));
          } else {
            res = await fetch(`/api/commit-log?file=${encodeURIComponent(file.name)}`);
          }
          if (!res.ok) {
            throw new Error(`${file.name}: 데이터 로드 실패(${res.status})`);
          }
          const payload = await res.json();
          return {
            fileName: file.name,
            payload,
          };
        }));

        if (mounted) {
          setTeamPayloads(loaded);
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

    loadAllTeamPayloads();
    return () => {
      mounted = false;
    };
  }, [logFiles]);

  const prepared = useMemo(
    () => buildPreparedTeamBattle(teamPayloads, identityRules.pairs),
    [teamPayloads, identityRules]
  );

  const nodes = prepared.nodes;
  const teamTotalSeries = prepared.teamTotalSeries;
  const authorSeries = prepared.authorSeries;
  const authorKeyById = prepared.authorKeyById;
  const teams = prepared.teams;
  const teamOptions = useMemo(
    () => teams.map((team) => ({ value: team.id, label: team.label })),
    [teams]
  );

  useEffect(() => {
    if (!teams.length) {
      setSelectedTeamIds([]);
      return;
    }

    setSelectedTeamIds((current) => {
      const availableIds = new Set(teams.map((team) => team.id));
      const preserved = current.filter((teamId) => availableIds.has(teamId)).slice(0, 3);
      if (preserved.length > 0) {
        return preserved;
      }
      return teams.slice(0, Math.min(3, teams.length)).map((team) => team.id);
    });
  }, [teams]);

  const selectedTeamSet = useMemo(
    () => new Set(selectedTeamIds),
    [selectedTeamIds]
  );
  const visibleTeams = useMemo(
    () => teams.filter((team) => selectedTeamSet.has(team.id)),
    [teams, selectedTeamSet]
  );
  const visibleNodes = useMemo(
    () => nodes.filter((node) => selectedTeamSet.has(node.teamId)),
    [nodes, selectedTeamSet]
  );
  const visibleTeamTotalSeries = useMemo(
    () => teamTotalSeries.filter((series) => selectedTeamSet.has(series.teamId)),
    [teamTotalSeries, selectedTeamSet]
  );
  const visibleAuthorIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.authorId)),
    [visibleNodes]
  );
  const visibleAuthorSeries = useMemo(
    () => authorSeries.filter((series) => visibleAuthorIds.has(series.id)),
    [authorSeries, visibleAuthorIds]
  );

  const topLongCommitPercent = useMemo(() => {
    if (topLongCommitPercentInput === '') {
      return 0;
    }
    const parsed = Number(topLongCommitPercentInput);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.min(100, Math.max(0, parsed));
  }, [topLongCommitPercentInput]);

  const topLongestCommitIds = useMemo(
    () => buildTopLongestCommitIdSet(visibleNodes, topLongCommitPercent / 100),
    [visibleNodes, topLongCommitPercent]
  );

  const zeroLengthCommitIds = useMemo(
    () => buildZeroLengthCommitIdSet(visibleNodes),
    [visibleNodes]
  );

  const activeExcludedCommitIds = useMemo(() => {
    if (!excludeTopLongCommits && !excludeZeroLengthCommit) {
      return null;
    }

    const excluded = new Set();
    if (excludeTopLongCommits) {
      for (const id of topLongestCommitIds) {
        excluded.add(id);
      }
    }
    if (excludeZeroLengthCommit) {
      for (const id of zeroLengthCommitIds) {
        excluded.add(id);
      }
    }
    return excluded;
  }, [excludeTopLongCommits, excludeZeroLengthCommit, topLongestCommitIds, zeroLengthCommitIds]);

  const metricForTrend = metricMode === 'commits' ? 'commits' : 'code';
  const useNetLines = metricMode === 'lines' && subtractDeletions;

  const teamRows = useMemo(
    () => buildTeamRows(
      visibleNodes,
      visibleTeamTotalSeries,
      metricForTrend,
      useNetLines,
      showProjectPercent,
      activeExcludedCommitIds
    ),
    [
      visibleNodes,
      visibleTeamTotalSeries,
      metricForTrend,
      useNetLines,
      showProjectPercent,
      activeExcludedCommitIds,
    ]
  );

  const authorRows = useMemo(
    () => buildAuthorRows(
      visibleNodes,
      visibleAuthorSeries,
      authorKeyById,
      metricForTrend,
      useNetLines,
      showProjectPercent,
      activeExcludedCommitIds
    ),
    [
      visibleNodes,
      visibleAuthorSeries,
      authorKeyById,
      metricForTrend,
      useNetLines,
      showProjectPercent,
      activeExcludedCommitIds,
    ]
  );

  const activeTrendRows = useMemo(() => {
    if (!teamRows.length && !authorRows.length) {
      return [];
    }
    if (!teamRows.length) {
      return authorRows;
    }
    if (!authorRows.length) {
      return teamRows;
    }
    const rowCount = Math.min(teamRows.length, authorRows.length);
    const rows = [];
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        ...teamRows[index],
        ...authorRows[index],
      });
    }
    return rows;
  }, [teamRows, authorRows]);
  const activeTrendSeries = useMemo(
    () => [...visibleTeamTotalSeries, ...visibleAuthorSeries],
    [visibleTeamTotalSeries, visibleAuthorSeries]
  );

  const trendDomain = useMemo(
    () => buildDomain(activeTrendRows, activeTrendSeries, showProjectPercent),
    [activeTrendRows, activeTrendSeries, showProjectPercent]
  );

  useEffect(() => {
    if (!activeTrendRows.length) {
      setActiveTrendIndex(null);
      return;
    }
    setActiveTrendIndex(activeTrendRows.length - 1);
  }, [activeTrendRows]);

  const activeMoment = useMemo(() => {
    if (!activeTrendRows.length) {
      return null;
    }
    const fallbackIndex = activeTrendRows.length - 1;
    const resolvedIndex = Number.isInteger(activeTrendIndex)
      ? Math.max(0, Math.min(fallbackIndex, activeTrendIndex))
      : fallbackIndex;
    return {
      index: resolvedIndex,
      row: activeTrendRows[resolvedIndex],
    };
  }, [activeTrendRows, activeTrendIndex]);

  const teamById = useMemo(
    () => new Map(visibleTeams.map((team) => [team.id, team])),
    [visibleTeams]
  );

  const userRankingRows = useMemo(() => {
    const row = activeMoment?.row;
    if (!row) {
      return [];
    }
    return visibleAuthorSeries
      .map((series) => {
        const signedValue = Number(row[series.key]) || 0;
        const team = teamById.get(series.teamId);
        return {
          ...series,
          teamLabel: team?.label ?? series.teamId ?? '-',
          signedValue,
          magnitude: Math.abs(signedValue),
        };
      })
      .filter((item) => item.magnitude > 0)
      .sort((a, b) => b.magnitude - a.magnitude);
  }, [activeMoment, visibleAuthorSeries, teamById]);

  const teamRectRows = useMemo(() => {
    const row = activeMoment?.row;
    if (!row) {
      return [];
    }

    return visibleTeamTotalSeries
      .map((item) => ({
        ...item,
        signedValue: Number(row[item.key]) || 0,
        magnitude: Math.abs(Number(row[item.key]) || 0),
        teamLabel: teamById.get(item.teamId)?.label ?? item.label,
        users: userRankingRows.filter((user) => user.teamId === item.teamId),
      }))
      .filter((item) => item.magnitude > 0)
      .sort((a, b) => b.magnitude - a.magnitude);
  }, [activeMoment, visibleTeamTotalSeries, teamById, userRankingRows]);

  const trendTitle = `${metricMode === 'commits' ? '커밋' : '라인'} 팀+사용자 통합 추이`;

  const trendDescription = showProjectPercent
    ? '팀 합계(굵은 선)와 사용자(얇은 선)를 같은 축에서 기여율(%)로 비교합니다.'
    : `팀 합계(굵은 선)와 사용자(얇은 선)를 같은 그래프에서 비교합니다. (${useNetLines ? '순변경' : '총변경'})`;

  const yAxisTickFormatter = showProjectPercent
    ? (value) => `${Number(value || 0).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
    : undefined;

  if (loading || fileListLoading) {
    return (
      <div className="center-screen">
        <Loader color={actionButtonColor} size="lg" />
        <Text size="sm" c="dimmed">팀간 배틀 데이터를 불러오는 중...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="center-screen">
        <Alert variant="light" color="gray" title="오류" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      </div>
    );
  }

  return (
    <main className="battle-shell">
      <div className="battle-scroll">
        <Card className="hero-card card-enter delay-0" radius="xl" p="lg" withBorder>
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Stack gap="xs">
              <Title order={2}>Team Battle</Title>
              <Text size="sm" c="dimmed">
                팀명은 `json 파일명` 기준이며, 한 번에 최대 3팀만 선택해서 비교할 수 있습니다.
              </Text>
            </Stack>
            <Group gap="xs" align="flex-end" wrap="wrap">
              <Button
                variant="default"
                color="gray"
                onClick={() => loadLogFiles({ manual: true })}
                loading={refreshingFileList}
              >
                팀 파일 새로고침
              </Button>
              <Button
                size="sm"
                color={actionButtonColor}
                variant="default"
                onClick={onToggleColorScheme}
                leftSection={isDarkMode ? <IconSun size={14} /> : <IconMoon size={14} />}
              >
                {isDarkMode ? '라이트 모드' : '다크 모드'}
              </Button>
            </Group>
          </Group>

          <MultiSelect
            label="비교 팀 선택 (최대 3)"
            data={teamOptions}
            value={selectedTeamIds}
            onChange={(values) => setSelectedTeamIds(values.slice(0, 3))}
            maxValues={3}
            searchable
            nothingFoundMessage="팀이 없습니다."
            mt="sm"
            w={420}
          />

          <Group gap="xs" mt="sm" wrap="wrap">
            {visibleTeams.map((team) => (
              <Badge
                key={`team-badge-${team.id}`}
                variant="light"
                styles={{
                  root: {
                    backgroundColor: withAlpha(team.color, 0.14),
                    borderColor: withAlpha(team.color, 0.44),
                    color: 'var(--text-main)',
                  },
                }}
              >
                {team.label}
              </Badge>
            ))}
          </Group>
          {selectedTeamIds.length === 0 && (
            <Text size="xs" c="dimmed" mt="xs">비교할 팀을 1개 이상 선택하세요.</Text>
          )}

          {identityRules.invalidLines.length > 0 && (
            <Text size="xs" c="dimmed" mt="xs">
              병합 규칙 {identityRules.invalidLines.length}개 줄은 형식 오류로 무시되었습니다.
            </Text>
          )}
          {identityRuleError && (
            <Alert variant="light" color="gray" icon={<IconAlertCircle size={14} />} mt="sm">
              작성자 병합 규칙 로드 실패: {identityRuleError}
            </Alert>
          )}
        </Card>

        <Card className="chart-card card-enter delay-2" radius="xl" p="lg" withBorder>
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Stack gap="xs">
              <Title order={4}>{trendTitle}</Title>
              <Text size="sm" c="dimmed">{trendDescription}</Text>
            </Stack>
            <Group gap="xs">
              <Button
                size="xs"
                color={actionButtonColor}
                radius={0}
                variant={metricMode === 'commits' ? 'filled' : 'default'}
                onClick={() => setMetricMode('commits')}
              >
                커밋 수
              </Button>
              <Button
                size="xs"
                color={actionButtonColor}
                radius={0}
                variant={metricMode === 'lines' ? 'filled' : 'default'}
                onClick={() => setMetricMode('lines')}
              >
                라인 수
              </Button>
            </Group>
          </Group>

          <div className="battle-option-slot">
            <Group gap="xs" wrap="nowrap" className="stack-chart-option-group">
              <Checkbox
                size="sm"
                color={actionButtonColor}
                radius={0}
                checked={showProjectPercent}
                onChange={(event) => setShowProjectPercent(event.currentTarget.checked)}
                label="기여율(%)"
              />
              <Group gap={6} wrap="nowrap">
                <Checkbox
                  size="sm"
                  color={actionButtonColor}
                  radius={0}
                  checked={excludeTopLongCommits}
                  onChange={(event) => setExcludeTopLongCommits(event.currentTarget.checked)}
                  label="긴 커밋 제외(상위"
                />
                <NumberInput
                  size="xs"
                  w={52}
                  min={0}
                  max={100}
                  step={1}
                  hideControls
                  placeholder="0"
                  value={topLongCommitPercentInput}
                  onChange={(value) => setTopLongCommitPercentInput(toNumericInputValue(value))}
                  styles={{
                    input: {
                      height: 24,
                      minHeight: 24,
                      paddingTop: 0,
                      paddingBottom: 0,
                      textAlign: 'center',
                    },
                  }}
                />
                <Text size="sm">%)</Text>
              </Group>
              <Checkbox
                size="sm"
                color={actionButtonColor}
                radius={0}
                checked={excludeZeroLengthCommit}
                onChange={(event) => setExcludeZeroLengthCommit(event.currentTarget.checked)}
                label="0줄 변경 커밋 제외"
              />
              <Checkbox
                size="sm"
                color={actionButtonColor}
                radius={0}
                checked={subtractDeletions}
                disabled={metricMode !== 'lines'}
                onChange={(event) => setSubtractDeletions(event.currentTarget.checked)}
                label="순변경으로 계산(+/-)"
              />
            </Group>
          </div>

          <Paper withBorder radius="md" p="sm" className="battle-dial-panel">
            <Group justify="space-between" align="center" mb={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>시점 다이얼</Text>
              <Text size="xs" c="dimmed">
                {activeMoment?.row ? formatKoreanDateTime(activeMoment.row.timestampMs) : '-'}
              </Text>
            </Group>
            <Slider
              min={0}
              max={Math.max(0, activeTrendRows.length - 1)}
              step={1}
              value={activeTrendIndex ?? Math.max(0, activeTrendRows.length - 1)}
              onChange={setActiveTrendIndex}
              disabled={activeTrendRows.length <= 1}
              color={actionButtonColor}
              label={null}
            />
          </Paper>

          <div className="battle-chart-layout">
            <Paper withBorder radius="md" p="sm" className="battle-ranking-panel">
              <Group justify="space-between" align="center" mb={8}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>사용자 랭킹</Text>
                <Badge color="gray" variant="light">{userRankingRows.length}명</Badge>
              </Group>
              <div className="battle-ranking-list">
                {userRankingRows.slice(0, 18).map((user, index) => (
                  <div key={`ranking-${user.key}`} className="battle-ranking-item">
                    <Text size="xs" fw={700} c="dimmed" className="battle-ranking-order">
                      {index + 1}
                    </Text>
                    <div className="battle-ranking-main">
                      <Text size="sm" fw={700} className="battle-ranking-name" style={{ color: user.stroke }}>
                        {user.label}
                      </Text>
                      <Text size="xs" c="dimmed">{user.teamLabel}</Text>
                    </div>
                    <Text size="sm" fw={700}>
                      {showProjectPercent
                        ? `${Number(user.signedValue).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                        : formatNumber(user.signedValue)}
                    </Text>
                  </div>
                ))}
              </div>
            </Paper>

            <Paper withBorder radius="md" p="sm" className="battle-rect-panel">
              <Group justify="space-between" align="center" mb={8}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>팀/사용자 점유 맵</Text>
                <Badge color="gray" variant="light">{teamRectRows.length}개 팀</Badge>
              </Group>
              <div className="battle-rect-map">
                {teamRectRows.map((teamRow) => (
                  <div
                    key={`rect-team-${teamRow.key}`}
                    className="battle-team-rect"
                    style={{
                      flexGrow: Math.max(1, teamRow.magnitude),
                      backgroundColor: withAlpha(teamRow.stroke, 0.16),
                      borderColor: withAlpha(teamRow.stroke, 0.55),
                    }}
                  >
                    <div className="battle-team-rect-head">
                      <Text size="xs" fw={700} className="battle-team-rect-title">{teamRow.teamLabel}</Text>
                    </div>
                    <div className="battle-team-rect-users">
                      {teamRow.users.map((user) => (
                        <div
                          key={`rect-user-${teamRow.key}-${user.key}`}
                          className="battle-user-rect"
                          style={{
                            flexGrow: Math.max(1, user.magnitude),
                            backgroundColor: user.stroke,
                          }}
                          title={`${user.label} (${user.teamLabel})`}
                        >
                          <span>{user.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Paper>

            <div className="battle-line-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeTrendRows} margin={{ top: 20, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                  <XAxis
                    dataKey="timestampMs"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(value) => formatKoreanDateTime(value)}
                    tickCount={6}
                  />
                  <YAxis
                    allowDecimals={showProjectPercent}
                    domain={trendDomain}
                    tickFormatter={yAxisTickFormatter}
                  />
                  {!showProjectPercent && metricMode === 'lines' && useNetLines && (
                    <ReferenceLine y={0} stroke={chartReferenceStroke} strokeDasharray="4 4" />
                  )}
                  {activeMoment?.row && (
                    <ReferenceLine x={activeMoment.row.timestampMs} stroke={chartReferenceStroke} strokeDasharray="4 4" />
                  )}
                  <Tooltip
                    labelFormatter={(value) => formatKoreanDateTime(value)}
                    formatter={(value, name) => {
                      return [
                        showProjectPercent
                          ? `${Number(value || 0).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                          : formatNumber(value),
                        name,
                      ];
                    }}
                  />
                  {activeTrendSeries.map((series) => (
                    <Line
                      key={series.key}
                      type="stepAfter"
                      name={series.label}
                      dataKey={series.key}
                      stroke={series.stroke}
                      strokeWidth={series.strokeWidth ?? 2}
                      strokeOpacity={series.opacity ?? 1}
                      dot={false}
                      activeDot={{ r: series.isTeamTotal ? 3.5 : 2.8 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>

        <Paper withBorder radius="md" p="sm" className="legend-card card-enter delay-3">
          <Group gap="xs" mb={8}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>선택 시점 팀 합계</Text>
            <Badge color="gray" variant="light">{visibleTeamTotalSeries.length}개 팀</Badge>
          </Group>
          <div className="author-legend">
            {teamRectRows.map((series) => {
              const value = Number(series.signedValue) || 0;
              return (
                <Text
                  key={`battle-series-${series.key}`}
                  size="sm"
                  fw={700}
                  className="author-name-item"
                  style={{ color: series.stroke }}
                >
                  {series.teamLabel}: {showProjectPercent
                    ? `${Number(value).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                    : formatNumber(value)}
                </Text>
              );
            })}
          </div>
        </Paper>
      </div>
    </main>
  );
}
