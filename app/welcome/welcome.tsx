import React from 'react';
import {SiInstagram, SiXiaohongshu} from "react-icons/si";
import {IoLibrarySharp} from "react-icons/io5";
import {HiMail} from "react-icons/hi";
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

    // Social icons that will appear below the main buttons
    const socialIcons = [
        {
            id: 1,
            title: 'Instagram',
            url: 'https://www.instagram.com/sekai_beyond/',
            icon: <SiInstagram size={32}/>
        },
        {
            id: 2,
            title: 'Xiaohongshu',
            url: 'https://www.xiaohongshu.com/user/profile/62d4eefd000000000e00ed42',
            icon: <SiXiaohongshu size={32}/>
        },
        {
            id: 3,
            title: 'RSO Directory',
            url: 'https://huskylink.washington.edu/organization/sekaibeyond',
            icon: <IoLibrarySharp size={32}/>
        },
        {
            id: 4,
            title: 'Email',
            url: 'mailto:sekaibeyond@outlook.com',
            icon: <HiMail size={32}/>
        },
    ];

    return (
        <div className="flex flex-col items-center min-h-screen bg-gradient-to-br from-purple-500 to-pink-500 p-6">
            <div className="w-full max-w-md bg-white rounded-lg shadow-xl overflow-hidden">
                {/* Header */}
                <div className="flex flex-col items-center p-6 bg-white">
                    <div className="w-36 h-36 rounded-full bg-purple-100 overflow-hidden mb-4">
                        <img
                            src={logoLight}
                            alt="Sekai Beyond Logo"
                            className="w-full h-full object-cover"
                        />
                    </div>
                    <h1 className="text-xl font-bold text-gray-800">Sekai Beyond 彼世界</h1>
                    <p className="text-sm text-gray-500 text-center mt-2">
                        Let's reach to the Sekai beyond the original world!
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

                {/* Social Icons Row*/}
                <div className="flex justify-center items-center gap-x-5 pb-4">
                    {socialIcons.map((icon) => (
                        <a
                            key={icon.id}
                            href={icon.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-600 hover:text-purple-600 transition-colors"
                            title={icon.title}
                        >
                            {icon.icon}
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