export const Venue = () => {
    return (
        <section id="venue" className="section venue-section">
            <div className="section-header">
                <h2 className="section-title">Venue Information</h2>
                <h3 className="section-title-cn">场地信息</h3>
                <p className="section-subtitle">
                    Join us at the beautiful University of Washington HUB Ballrooms for an unforgettable experience
                </p>
            </div>
            <div className="venue-content">
                <div className="venue-info">
                    <div className="venue-header">
                        <h3 className="venue-name">HUB Ballrooms</h3>
                        <p className="venue-name-cn">华盛顿大学学生活动中心舞厅</p>
                    </div>
                    <div className="venue-details">
                        <div className="venue-item">
                            <div className="venue-icon">📍</div>
                            <div className="venue-text">
                                <h4>Address 地址</h4>
                                <p>4001 E Stevens Way NE, Seattle, WA 98195</p>
                            </div>
                        </div>
                        <div className="venue-item">
                            <div className="venue-icon">🚇</div>
                            <div className="venue-text">
                                <h4>Public Transit 公共交通</h4>
                                <p>Metro Bus Routes 43, 48, 271, 372 to UW Campus</p>
                            </div>
                        </div>
                        <div className="venue-item">
                            <div className="venue-icon">🚗</div>
                            <div className="venue-text">
                                <h4>Parking 停车</h4>
                                <a
                                    href="https://transportation.uw.edu/park/visitor"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="venue-link"
                                >
                                    Central Plaza Garage & other campus parking 校园停车场
                                </a>
                            </div>
                        </div>
                        <div className="venue-item">
                            <div className="venue-icon">🏨</div>
                            <div className="venue-text">
                                <h4>Nearby Hotels 附近酒店</h4>
                                <a
                                    href="https://www.google.com/search?q=hotels+near+HUB+Ballrooms+University+of+Washington+Seattle"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="venue-link"
                                >
                                    University District & Downtown Seattle options
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="venue-map-container">
                    <iframe
                        src="https://www.google.com/maps/embed/v1/place?key=AIzaSyBInxCeVd_hf3CYBdfanSOUcOvezg-Nffo&q=HUB+Ballrooms,University+of+Washington,Seattle,WA"
                        width="100%"
                        height="100%"
                        style={{border: 0, borderRadius: '15px'}}
                        allowFullScreen
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        title="HUB Ballrooms Location"
                        className="venue-map"
                    />
                </div>
            </div>
        </section>
    );
};