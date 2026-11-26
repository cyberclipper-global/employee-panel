import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import NeuralNetwork from "../../components/bg-animation";
import { useAuth } from "../../context/AuthContext";
import LoginFlow from "../../components/auth/LoginFlow";

// Sign-in: registered email + one-time code. Verified on the server (/api/auth/*).
const Login = () => {
  const router = useRouter();
  const { refreshSession } = useAuth();
  const [notice, setNotice] = useState("");
  const initialEmail = typeof router.query.email === "string" ? router.query.email : "";

  // Old invitation links carried ?token=...; sign-in only needs the email,
  // so drop it from the address bar.
  useEffect(() => {
    if (router.isReady && router.query.token) {
      const { token, ...rest } = router.query; // eslint-disable-line no-unused-vars
      router.replace({ pathname: "/auth/login", query: rest }, undefined, { shallow: true });
    }
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("logoutSuccess")) {
      setNotice("Logged out successfully!");
      localStorage.removeItem("logoutSuccess");
      setTimeout(() => setNotice(""), 2500);
    }
  }, []);

  const onSignedIn = async () => {
    const ok = await refreshSession();
    if (!ok) throw new Error("Could not start your session. Please try again.");
    const next = typeof router.query.next === "string" && router.query.next.startsWith("/") && !router.query.next.startsWith("//") ? router.query.next : "/playground";
    router.replace(next);
  };

  return (
    <div className="min-h-screen w-screen font-manrope relative overflow-hidden flex items-center justify-center">
      <div className="absolute inset-0 bg-white/5 backdrop-blur-xs z-0" />
      <NeuralNetwork />
      <div className="flex flex-col md:flex-row relative z-10 w-full h-full max-w-7xl mx-auto">
        {/* Left Section */}
        <div className="flex-1 flex flex-col justify-start items-start py-8 px-4 sm:px-8 md:py-[5vh] md:px-[4vw] relative bg-white/5 backdrop-blur-xs w-full md:w-auto">
          {/* Branding Info */}
          <div className="max-w-full md:max-w-[500px]">
            <h1 className="text-[32px] sm:text-[40px] md:text-[50px] mt-4 md:mt-8 font-extrabold text-[#16a34a] mb-3 md:mb-4">
              Employee Portal
            </h1>
            <p className="text-[15px] sm:text-[16px] md:text-[18px] leading-relaxed text-[#fff]">
              Access your workspace, manage tasks, and collaborate with your
              team. Our employee portal is designed to enhance productivity and
              streamline your workflow.
            </p>
            <ul className="mt-4 md:mt-5 pl-5 text-[#16a34a] font-semibold list-disc text-[14px] sm:text-[15px] md:text-[16px]">
              <li>Task management</li>
              <li>Team collaboration</li>
              <li>Secure access</li>
            </ul>
            {/* Brief additional info */}
            <p className="mt-4 md:mt-5 text-[13px] sm:text-[14px] md:text-[15px] text-[#fff]">
              Log in with your employee credentials to access your personalized
              dashboard and company resources.
            </p>
          </div>
        </div>
        {/* Right Section (Sign In Form) */}
        <div className="flex-1 flex justify-center items-center py-8 px-4 sm:px-8 md:py-[5vh] md:px-[4vw] w-full md:w-auto">
          <div className="bg-gray-300 rounded-xl w-full max-w-[95vw] sm:max-w-[420px] pt-2 pb-4 px-4 sm:pt-3 sm:pb-6 sm:px-6 md:pt-4 md:pb-8 md:px-8 flex flex-col gap-4">
            <h2 className="text-[24px] sm:text-[28px] md:text-[30px] font-extrabold text-[#16a34a]">Sign In</h2>
            <p className="text-[#6b7280] text-[14px] sm:text-[15px]">Enter your registered email. We will send you a one-time code.</p>
            {notice && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</div>}
            <LoginFlow
              initialEmail={initialEmail}
              onSignedIn={onSignedIn}
              footer={<div className="text-[14px] sm:text-[15px] text-[#4b5563] text-center">Contact your supervisor for login assistance</div>}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
