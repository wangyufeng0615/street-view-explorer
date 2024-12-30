import React from 'react';

export default function LeaderboardList({ data }) {
    return (
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'white' }}>
                    <tr>
                        <th style={styles.th}>排名</th>
                        <th style={styles.th}>位置</th>
                        <th style={styles.th}>点赞数</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((item, index) => (
                        <tr key={item.location_id}>
                            <td style={styles.td}>{index + 1}</td>
                            <td style={styles.td}>
                                {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                            </td>
                            <td style={styles.td}>{item.likes}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const styles = {
    th: {
        padding: '8px',
        borderBottom: '2px solid #ddd',
        textAlign: 'left',
    },
    td: {
        padding: '8px',
        borderBottom: '1px solid #ddd',
    }
};
