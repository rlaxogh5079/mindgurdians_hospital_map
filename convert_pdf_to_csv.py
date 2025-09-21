import argparse
import re
import pandas as pd
import pdfplumber

def try_pdfplumber_tables(pdf_path: str) -> pd.DataFrame:
    frames = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            try:
                tables = page.extract_tables({
                    "vertical_strategy": "lines",
                    "horizontal_strategy": "lines",
                    "intersection_tolerance": 5,
                    "snap_tolerance": 6,
                    "join_tolerance": 6,
                    "edge_min_length": 3,
                })
            except Exception:
                tables = []
            for tbl in tables or []:
                if not tbl or len(tbl) < 2:
                    continue
                header = [str(x).strip() if x is not None else "" for x in tbl[0]]
                rows = [[str(x).strip() if x is not None else "" for x in r] for r in tbl[1:]]
                df = pd.DataFrame(rows, columns=header)
                frames.append(df)
    if not frames:
        return pd.DataFrame()
    df_all = pd.concat(frames, ignore_index=True)
    df_all = df_all.loc[:, ~df_all.columns.duplicated()]
    df_all.columns = [re.sub(r"\s+", "", c) for c in df_all.columns]
    rename_map = {}
    for c in list(df_all.columns):
        k = c
        if re.search(r"(연번|번호)", c): rename_map[c] = "연번"
        elif re.search(r"(시[도]|광역시|특별시|도)\b", c): rename_map[c] = "시도"
        elif re.search(r"(시군구|구|군|시)\b", c) and "시도" not in c: rename_map[c] = "시군구"
        elif re.search(r"(주소|소재지)", c): rename_map[c] = "주소"
        elif re.search(r"(기관명|기관|병원명|명칭)", c): rename_map[c] = "기관명"
        elif re.search(r"(대표전화|전화|연락처)", c): rename_map[c] = "대표전화"
        elif re.search(r"(종별|종별구분)", c): rename_map[c] = "종별구분"
        elif re.search(r"(설립|설립구분)", c): rename_map[c] = "설립구분"
        elif re.search(r"(행정입원)", c): rename_map[c] = "행정입원"
        elif re.search(r"(폐쇄병상)", c): rename_map[c] = "폐쇄병상"
        elif re.search(r"(개방병상)", c): rename_map[c] = "개방병상"
        elif re.search(r"(입원병상.*야간|공휴일)", c): rename_map[c] = "입원병상운영_야간공휴일"
        elif re.search(r"(응급입원)", c): rename_map[c] = "응급입원"
        elif re.search(r"(낮병동)", c): rename_map[c] = "낮병동운영"
        elif re.search(r"(상급종합)", c): rename_map[c] = "상급종합병원여부"
    df_all = df_all.rename(columns=rename_map)
    want = ["연번","시도","시군구","주소","기관명","대표전화","종별구분","설립구분","행정입원","폐쇄병상","개방병상","입원병상운영_야간공휴일","응급입원","낮병동운영","상급종합병원여부"]
    for w in want:
        if w not in df_all.columns:
            df_all[w] = ""
    df_all = df_all[want]
    df_all = df_all[~df_all["기관명"].eq("")]
    return df_all.reset_index(drop=True)

def try_text_regex(pdf_path: str) -> pd.DataFrame:
    try:
        from pdfminer.high_level import extract_text
    except Exception:
        return pd.DataFrame()
    text = extract_text(pdf_path)
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines() if ln and ln.strip()]
    phone_re = re.compile(r"\b0\d{1,2}-\d{3,4}-\d{4}\b")
    index_re = re.compile(r"^\d+\b")
    cat_pair_re = re.compile(r"(\d+)\.\s*([가-힣A-Za-z]+)")
    name_keywords = ["정신건강의학과","정신과","병원","의원","한방병원","한의원"]
    rows = []
    def split_addr_name(pre_phone: str):
        last_pos = -1
        last_kw = None
        for kw in name_keywords:
            pos = pre_phone.rfind(kw)
            if pos > last_pos:
                last_pos = pos
                last_kw = kw
        if last_pos == -1:
            parts = pre_phone.split()
            if len(parts) >= 3:
                name = " ".join(parts[-2:])
                addr = " ".join(parts[:-2])
            elif len(parts) >= 2:
                name = parts[-1]
                addr = " ".join(parts[:-1])
            else:
                addr = pre_phone
                name = ""
            return addr.strip(), name.strip()
        start_idx = pre_phone.rfind(" ", 0, last_pos)
        if start_idx == -1:
            return "", pre_phone.strip()
        return pre_phone[:start_idx].strip(), pre_phone[start_idx+1:].strip()
    for ln in lines:
        if not index_re.match(ln):
            continue
        m_phone = phone_re.search(ln)
        if not m_phone:
            continue
        idx_token = ln.split()[0]
        rest = ln[len(idx_token):].strip()
        m2 = phone_re.search(rest)
        if not m2:
            continue
        pre = rest[:m2.start()].strip()
        phone = m2.group(0)
        post = rest[m2.end():].strip()
        addr, name = split_addr_name(pre)
        addr_tokens = addr.split()
        si_do = addr_tokens[0] if addr_tokens else ""
        si_gungu = addr_tokens[1] if len(addr_tokens) >= 2 else ""
        cats = cat_pair_re.findall(post)
        jongbyeol = cats[0][1] if len(cats) >= 1 else ""
        seollip = cats[1][1] if len(cats) >= 2 else ""
        flags = re.findall(r"\bO\b", post)
        row = {
            "연번": idx_token,
            "시도": si_do,
            "시군구": si_gungu,
            "주소": addr,
            "기관명": name,
            "대표전화": phone,
            "종별구분": jongbyeol,
            "설립구분": seollip,
            "행정입원": "",
            "폐쇄병상": "",
            "개방병상": "",
            "입원병상운영_야간공휴일": "",
            "응급입원": "",
            "낮병동운영": "",
            "상급종합병원여부": ""
        }
        for i, v in enumerate(flags[:7]):
            key = ["행정입원","폐쇄병상","개방병상","입원병상운영_야간공휴일","응급입원","낮병동운영","상급종합병원여부"][i]
            row[key] = "O"
        rows.append(row)
    df = pd.DataFrame(rows)
    if not df.empty:
        try:
            df["연번"] = df["연번"].astype(int)
            df = df.sort_values("연번").reset_index(drop=True)
        except Exception:
            pass
    return df

def main():
    df = try_pdfplumber_tables('./의료기관 데이터.pdf')
    if df.empty:
        print("경고: 추출된 행이 없습니다. 패턴을 조정하거나 테이블형 파서 사용을 검토하세요.")
    df.to_csv('./out.csv', index=False, encoding="utf-8-sig")
    
if __name__ == "__main__":
    main()