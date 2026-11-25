#!/usr/bin/env python3
"""用 Python 标准库读取飞书通讯录导出的 XLSX（不依赖第三方包）。

必需列：用户 ID、姓名、联系手机、部门；可选列：直属上级、账号状态、职位（或“职务”）。
输出 JSON 只交给 import-contacts.cjs 使用，不要把输出保存或转发。
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def read_contacts(filename):
    with zipfile.ZipFile(filename) as workbook:
        if len(workbook.infolist()) > 2000 or sum(i.file_size for i in workbook.infolist()) > 20 * 1024 * 1024:
            raise ValueError('工作簿解压后过大，请精简至 500 位以内。')
        shared = []
        if 'xl/sharedStrings.xml' in workbook.namelist():
            shared = [''.join(item.itertext()) for item in ET.fromstring(workbook.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        sheets = [name for name in workbook.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', name)]
        for sheet in sorted(sheets):
            headers = None
            contacts = []
            for row in ET.fromstring(workbook.read(sheet)).findall('s:sheetData/s:row', NS):
                cells = {}
                for cell in row.findall('s:c', NS):
                    column = re.match(r'[A-Z]+', cell.attrib['r']).group()
                    value = cell.find('s:v', NS)
                    text = (value.text or '') if value is not None else ''
                    if cell.attrib.get('t') == 's':
                        text = shared[int(text)]
                    elif cell.attrib.get('t') == 'inlineStr':
                        text = ''.join(cell.find('s:is', NS).itertext())
                    cells[column] = text.strip()
                if {'用户 ID', '姓名', '联系手机', '部门'}.issubset(cells.values()):
                    headers = {value: column for column, value in cells.items() if value}
                    continue
                if not headers:
                    continue
                get = lambda key: cells.get(headers.get(key), '')
                if not get('姓名'):
                    continue
                if ',' in get('部门') or '，' in get('部门'):
                    raise ValueError(f"第 {row.attrib['r']} 行包含多个所属部门，请先明确主部门。")
                parts = [part.strip() for part in get('部门').split('/') if part.strip()]
                if not parts or len(parts) > 3:
                    raise ValueError(f"第 {row.attrib['r']} 行的组织需为公司及最多两级部门。")
                phone = re.sub(r'[\s-]', '', get('联系手机')).removeprefix('+86')
                if not re.fullmatch(r'1[3-9]\d{9}', phone):
                    raise ValueError(f"第 {row.attrib['r']} 行手机号格式不正确。")
                names = [name.strip() for name in get('姓名').split('|') if name.strip()]
                manager = re.search(r'(?:\+86)?(1[3-9]\d{9})', get('直属上级'))
                if get('直属上级') and not manager:
                    raise ValueError(f"第 {row.attrib['r']} 行直属上级无法按手机号匹配。")
                if get('账号状态') not in ('', '正常'):
                    raise ValueError(f"第 {row.attrib['r']} 行账号状态需要单独处理。")
                title = (get('职位') or get('职务'))[:40]
                if len(contacts) >= 500:
                    raise ValueError('一次导入最多 500 位成员。')
                contacts.append({'sourceId': get('用户 ID'), 'sourceRow': int(row.attrib['r']), 'name': names[0], 'alternateNames': names[1:], 'phone': phone, 'company': parts[0], 'departments': parts[1:], 'managerPhone': manager.group(1) if manager else None, 'title': title})
            if contacts:
                return contacts
    raise ValueError('未找到带有用户 ID、姓名、联系手机和部门的通讯录工作表。')


if __name__ == '__main__':
    try:
        print(json.dumps(read_contacts(sys.argv[1]), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
