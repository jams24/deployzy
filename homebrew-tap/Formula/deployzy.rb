class Deployzy < Formula
  desc "Open-source tunnel to expose your local servers to the internet"
  homepage "https://deployzy.com"
  version "1.1.4"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/jams24/deployzy/releases/download/v#{version}/deployzy_darwin_arm64.tar.gz"
      sha256 "af10f7974501c8ae24157a600d99697428553266b0aeedb532e4478536c904bf"
    else
      url "https://github.com/jams24/deployzy/releases/download/v#{version}/deployzy_darwin_amd64.tar.gz"
      sha256 "100c3c07265a854ed607fb809144b97ec75cdbb21912ec1115d60ac05ff43a4f"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/jams24/deployzy/releases/download/v#{version}/deployzy_linux_arm64.tar.gz"
      sha256 "ab3152d3b98fa60016f9ec67def881536cc6844cee6160bc8dd488e0cb11e2c3"
    else
      url "https://github.com/jams24/deployzy/releases/download/v#{version}/deployzy_linux_amd64.tar.gz"
      sha256 "282d1afa0e1027925e3021587b783b07d149b7621ae43e62b44afa4ae594bd3f"
    end
  end

  def install
    bin.install "deployzy"
  end

  test do
    assert_match "deployzy version", shell_output("#{bin}/deployzy version")
  end
end
