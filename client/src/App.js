import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const KAKAO_APP_KEY = process.env.REACT_APP_KAKAO_MAP_KEY;
const KAKAO_SDK_URL = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&autoload=false&libraries=services,clusterer`;
const GEOCODE_CACHE_KEY = "geocode_cache_v1";

function App() {
  const mapContainerRef = useRef(null);
  const mapState = useRef({
    map: null,
    markers: [],
    bounds: null,
    clusterer: null,
  });
  const selectionRef = useRef({ sido: "", sigungu: "" });
  const [rows, setRows] = useState([]);
  const [selectedSido, setSelectedSido] = useState("");
  const [selectedSigungu, setSelectedSigungu] = useState("");
  const [visibleCount, setVisibleCount] = useState(0);
  const [failedList, setFailedList] = useState([]);
  const [status, setStatus] = useState(
    KAKAO_APP_KEY
      ? "지도를 준비하는 중입니다..."
      : ".env 파일에 REACT_APP_KAKAO_MAP_KEY=카카오JavaScript키 를 넣어주세요."
  );

  useEffect(() => {
    if (!KAKAO_APP_KEY) {
      return;
    }

    let isMounted = true;

    const injectScript = () =>
      new Promise((resolve, reject) => {
        if (window.kakao?.maps) {
          resolve();
          return;
        }

        const existing = document.getElementById("kakao-map-sdk");
        if (existing) {
          existing.addEventListener("load", resolve);
          existing.addEventListener("error", reject);
          return;
        }

        const script = document.createElement("script");
        script.id = "kakao-map-sdk";
        script.src = KAKAO_SDK_URL;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });

    const mountMap = () => {
      window.kakao.maps.load(() => {
        if (!isMounted || !mapContainerRef.current) return;

        const map = new window.kakao.maps.Map(mapContainerRef.current, {
          center: new window.kakao.maps.LatLng(37.5665, 126.978),
          level: 7,
        });

        const clusterer = new window.kakao.maps.MarkerClusterer({
          map,
          averageCenter: true,
          minLevel: 6,
          disableClickZoom: false,
        });

        mapState.current = {
          map,
          markers: [],
          bounds: new window.kakao.maps.LatLngBounds(),
          clusterer,
        };

        setStatus("병원 데이터를 불러오는 중입니다...");
        loadCsvAndRender();
      });
    };

    injectScript()
      .then(mountMap)
      .catch(() => setStatus("카카오 지도 스크립트를 불러오지 못했습니다."));

    return () => {
      isMounted = false;
      mapState.current.markers.forEach((marker) => marker.setMap(null));
    };
  }, []);

  const loadCsvAndRender = async () => {
    try {
      setStatus("미리 계산된 좌표가 있는지 확인 중...");
      const precomputed = await loadPrecomputedGeo();
      if (precomputed.length) {
        setRows(precomputed);
        renderPrecomputed(precomputed);
        return;
      }

      const response = await fetch(`${process.env.PUBLIC_URL}/out.csv`);
      if (!response.ok) throw new Error("CSV 요청 실패");

      const text = await response.text();
      const parsedRows = parseCsv(text);
      setRows(parsedRows);
      setFailedList([]);

      if (!parsedRows.length) {
        setStatus("CSV 에서 주소를 찾지 못했습니다.");
        return;
      }

      setStatus("좌표가 없어 지오코딩을 시작합니다. (최초 1회)");
      placeMarkers(parsedRows);
    } catch (error) {
      console.error(error);
      setStatus("CSV 파일을 불러오는데 실패했습니다.");
    }
  };

  const loadPrecomputedGeo = async () => {
    try {
      const res = await fetch(
        `${process.env.PUBLIC_URL}/out_geocoded.json?_=${Date.now()}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data) ? data : []).filter(
        (d) =>
          d &&
          typeof d.lat === "number" &&
          typeof d.lng === "number" &&
          d.lat !== 0 &&
          d.lng !== 0
      );
    } catch (_) {
      return [];
    }
  };

  const parseCsv = (text) => {
    const cleanText = text.replace(/^\uFEFF/, "").trim();
    const lines = cleanText.split(/\r?\n/).filter(Boolean);
    lines.shift(); // header

    return lines
      .map((line) => {
        const cells = splitCsvLine(line);
        if (cells.length < 6) return null;

        const [, sido, sigungu1, sigungu2, addr, name, phone] = cells;
        const regionWithDetail = [sido, sigungu1, sigungu2]
          .map((v) => (v || "").trim())
          .filter(Boolean)
          .join(" ");
        const fullAddress = [regionWithDetail, addr].filter(Boolean).join(" ").trim();

        if (!fullAddress || !name) return null;

        return {
          sido: (sido || "").trim(),
          sigungu: [sigungu1, sigungu2]
            .map((v) => (v || "").trim())
            .filter(Boolean)
            .join(" "),
          name: name.trim(),
          phone: phone?.trim(),
          address: fullAddress,
        };
      })
      .filter(Boolean);
  };

  const splitCsvLine = (line) => {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];

      if (char === '"' && next === '"' && inQuotes) {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  };

  const safeText = (value = "") =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const matchesFilter = (row, sido = selectionRef.current.sido, sigungu = selectionRef.current.sigungu) => {
    const matchSido = !sido || row.sido === sido;
    const matchSigungu = !sigungu || row.sigungu === sigungu;
    return matchSido && matchSigungu;
  };

  const applyFilter = (fitMap = true) => {
    const { map, markers, clusterer } = mapState.current;
    if (!map || !clusterer) return;

    const bounds = new window.kakao.maps.LatLngBounds();
    let visible = 0;
    const visibleMarkers = [];

    markers.forEach(({ marker, row, position }) => {
      const isVisible = matchesFilter(row);
      if (isVisible) {
        visibleMarkers.push(marker);
        bounds.extend(position);
        visible += 1;
      }
    });

    clusterer.clear();
    if (visibleMarkers.length) {
      clusterer.addMarkers(visibleMarkers);
      if (fitMap) {
        map.setBounds(bounds);
      }
    }

    mapState.current.bounds = bounds;
    setVisibleCount(visible);
    if (markers.length) {
      setStatus(`${visible}개 표시 중 (총 ${markers.length}개 geocoding 완료)`);
    }
  };

  const handleSidoChange = (e) => {
    const value = e.target.value;
    setSelectedSido(value);
    setSelectedSigungu("");
    selectionRef.current = { sido: value, sigungu: "" };
    applyFilter(true);
  };

  const handleSigunguChange = (e) => {
    const value = e.target.value;
    setSelectedSigungu(value);
    selectionRef.current = { sido: selectedSido, sigungu: value };
    applyFilter(true);
  };

  const fitVisibleMarkers = () => applyFilter(true);

  const sidoOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.sido).filter(Boolean))).sort(),
    [rows]
  );

  const sigunguOptions = useMemo(() => {
    if (!selectedSido) return [];
    return Array.from(
      new Set(
        rows
          .filter((r) => r.sido === selectedSido)
          .map((r) => r.sigungu)
          .filter(Boolean)
      )
    ).sort();
  }, [rows, selectedSido]);

  const placeMarkers = (rows) => {
    const { map } = mapState.current;
    if (!map) return;

    const geocoder = new window.kakao.maps.services.Geocoder();
    const placeSearcher = new window.kakao.maps.services.Places();
    const MAX_CONCURRENCY = 8; // 너무 크면 카카오 쿼터 제한(429)으로 실패
    const REQUEST_INTERVAL = 80; // QPS 제한 회피
    let lastRequestTime = 0;

    let processed = 0;
    let marked = 0;
    let active = 0;
    let cursor = 0;
    let failed = 0;
    let completedImmediate = 0;
    const failedRows = [];

    const cached =
      JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}") || {};
    const saveCache = () =>
      localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cached));

    const launchNext = () => {
      while (active < MAX_CONCURRENCY && cursor < rows.length) {
        const row = rows[cursor];
        cursor += 1;
        active += 1;

        // 캐시/사전좌표 우선 처리
        if (row.lat && row.lng) {
          addMarkerDirect(row, row.lat, row.lng);
          active -= 1;
          processed += 1;
          completedImmediate += 1;
          continue;
        }

        if (cached[row.address]) {
          const { lat, lng } = cached[row.address];
          addMarkerDirect(row, lat, lng);
          active -= 1;
          processed += 1;
          completedImmediate += 1;
          continue;
        }

        const now = Date.now();
        const wait = Math.max(0, lastRequestTime + REQUEST_INTERVAL - now);
        lastRequestTime = now + wait;

        setTimeout(() => {
          geocoder.addressSearch(row.address, (result, status) => {
            processed += 1;
            active -= 1;

            if (status === window.kakao.maps.services.Status.OK && result[0]) {
              const { x, y } = result[0];
              const position = new window.kakao.maps.LatLng(y, x);
              cached[row.address] = { lat: y, lng: x };
              saveCache();
              addMarkerDirect(row, y, x);
              marked += 1;
            } else {
              // 주소 검색 실패 시 지역/건물명을 활용한 키워드 검색으로 순차 fallback
              const queries = [
                `${row.address} ${row.name || ""}`,
                `${row.sido || ""} ${row.sigungu || ""} ${row.name || ""}`,
                `${row.sido || ""} ${row.sigungu || ""} ${row.address || ""}`,
              ]
                .map((q) => q.trim())
                .filter(Boolean);

              const tryKeyword = (idx = 0) => {
                if (idx >= queries.length) {
                  failed += 1;
                  failedRows.push({ row, reason: status || "PLACE_ZERO_RESULT" });
                  updateProgress();
                  launchNext();
                  return;
                }

                placeSearcher.keywordSearch(
                  queries[idx],
                  (data, psStatus) => {
                    if (psStatus === window.kakao.maps.services.Status.OK && data[0]) {
                      const { x, y } = data[0];
                      cached[row.address] = { lat: Number(y), lng: Number(x) };
                      saveCache();
                      addMarkerDirect(row, Number(y), Number(x));
                      marked += 1;
                      updateProgress();
                      launchNext();
                    } else {
                      tryKeyword(idx + 1);
                    }
                  },
                  { size: 3 }
                );
              };

              tryKeyword();
              return; // fallback 후처리는 tryKeyword에서 처리
            }

            updateProgress();
            launchNext();
          });
        }, wait);
      }
    };

    const updateProgress = () => {
      if (processed === rows.length) {
        setStatus(
          `${marked}개 표시 완료, ${failed}개 지오코딩 실패 (필터 반영됨)`
        );
        setFailedList(failedRows);
        applyFilter(true);
      } else if (processed % 100 === 0) {
        setStatus(
          `${processed}/${rows.length}개 처리 중... (${marked}개 성공, ${failed}개 실패)`
        );
        applyFilter(false);
      }
    };

    const addMarkerDirect = (row, lat, lng) => {
      const { map, clusterer } = mapState.current;
      if (!map || !clusterer) return;

      const position = new window.kakao.maps.LatLng(lat, lng);
              const marker = new window.kakao.maps.Marker({ position });

              const infoWindow = new window.kakao.maps.InfoWindow({
                content: `<div class="info-window"><strong>${safeText(
                  row.name
                )}</strong><div>${safeText(row.address)}</div>${
                  row.phone ? `<div>${safeText(row.phone)}</div>` : ""
                }</div>`,
              });

              window.kakao.maps.event.addListener(marker, "click", () =>
                infoWindow.open(map, marker)
              );

      const markerEntry = { marker, row, position };
      mapState.current.markers.push(markerEntry);

      if (matchesFilter(row)) {
        clusterer.addMarker(marker);
        setVisibleCount((prev) => prev + 1);
      }
    };

    launchNext();
  };

  const renderPrecomputed = (geoRows) => {
    const { map, clusterer } = mapState.current;
    if (!map || !clusterer) return;

    clusterer.clear();
    mapState.current.markers = [];
    const bounds = new window.kakao.maps.LatLngBounds();
    let visible = 0;

    geoRows.forEach((row) => {
      const position = new window.kakao.maps.LatLng(row.lat, row.lng);
      const marker = new window.kakao.maps.Marker({ position });
      const infoWindow = new window.kakao.maps.InfoWindow({
        content: `<div class="info-window"><strong>${safeText(
          row.name
        )}</strong><div>${safeText(row.address)}</div>${
          row.phone ? `<div>${safeText(row.phone)}</div>` : ""
        }</div>`,
      });
      window.kakao.maps.event.addListener(marker, "click", () =>
        infoWindow.open(map, marker)
      );

      const markerEntry = { marker, row, position };
      mapState.current.markers.push(markerEntry);

      if (matchesFilter(row)) {
        clusterer.addMarker(marker);
        bounds.extend(position);
        visible += 1;
      }
    });

    mapState.current.bounds = bounds;
    if (visible) {
      map.setBounds(bounds);
      setVisibleCount(visible);
    }
    setStatus(
      `${visible}개 표시 중 (사전 계산된 좌표 사용, 총 ${geoRows.length}개)`
    );
  };

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>병원 지도</h1>
          <p>out.csv 주소를 카카오맵에 표시합니다.</p>
        </div>
        <div className="app__controls">
          <label>
            시도
            <select value={selectedSido} onChange={handleSidoChange}>
              <option value="">전체</option>
              {sidoOptions.map((sido) => (
                <option key={sido} value={sido}>
                  {sido}
                </option>
              ))}
            </select>
          </label>
          <label>
            시군구
            <select
              value={selectedSigungu}
              onChange={handleSigunguChange}
              disabled={!selectedSido}
            >
              <option value="">전체</option>
              {sigunguOptions.map((sgg) => (
                <option key={sgg} value={sgg}>
                  {sgg}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="fit-btn" onClick={fitVisibleMarkers}>
            현재 선택으로 지도 맞추기
          </button>
          <div className="app__status">
            {status}
            {visibleCount ? ` · 화면에 ${visibleCount}개` : ""}
          </div>
        </div>
      </header>
      <div className="map" ref={mapContainerRef}>
        {!KAKAO_APP_KEY && (
          <div className="map__overlay">
            카카오 API 키를 설정한 후 다시 실행해주세요.
          </div>
        )}
      </div>
      {failedList.length > 0 && (
        <div className="fail-panel">
          <div className="fail-panel__title">
            지오코딩 실패 {failedList.length}건 (최대 50건 표시)
          </div>
          <ul>
            {failedList.slice(0, 50).map(({ row, reason }, idx) => (
              <li key={`${row.name}-${idx}`}>
                <strong>{row.name}</strong> | {row.address} | 전화:
                {row.phone || "-"} | 상태: {reason || "알 수 없음"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;
