import React from 'react';
import {SiInstagram, SiXiaohongshu} from "react-icons/si";
import logoLight from "./logo.jpg";

export const Welcome = () => {
    // Links for the Sekai Beyond
    const links = [
        {
            id: 1,
            title: 'Instagram',
            url: 'https://www.instagram.com/sekai_beyond/',
            icon: <SiInstagram size={20}/>
        },
        {
            id: 2,
            title: 'Xiaohongshu 小红书',
            url: 'https://www.xiaohongshu.com/user/profile/62d4eefd000000000e00ed42',
            icon: <SiXiaohongshu size={20}/>
        },
    ];

    return (
        <div className="flex flex-col items-center min-h-screen bg-gradient-to-br from-purple-500 to-pink-500 p-6">
            <div className="w-full max-w-md bg-white rounded-lg shadow-xl overflow-hidden">
                {/* Header */}
                <div className="flex flex-col items-center p-6 bg-white">
                    <div className="w-24 h-24 rounded-full bg-purple-100 overflow-hidden mb-4">
                        <img
                            src={logoLight}
                            alt="Sekai Beyond Logo"
                            className="w-full h-full object-cover"
                        />
                    </div>
                    <h1 className="text-xl font-bold text-gray-800">Sekai Beyond 彼世界</h1>
                    <p className="text-sm text-gray-500 text-center mt-2">
                        Let’s reach to the Sekai beyond the original world!
                        <br/>
                        University of Washington, Seattle, WA
                    </p>
                </div>

                {/* Links */}
                <div className="p-6 pt-0">
                    {links.map((link) => (
                        <a
                            key={link.id}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full p-3 mb-3 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors text-gray-800 font-medium text-center"
                        >
                            {link.icon && <span className="text-purple-600">{link.icon}</span>}
                            {link.title}
                        </a>
                    ))}
                </div>

                {/* Footer */}
                <div className="p-4 text-center border-t border-gray-200">
                    <p className="text-xs text-gray-500">
                        © 2025 Sekai Beyond • All rights reserved
                    </p>
                </div>
            </div>
        </div>
    );
};
