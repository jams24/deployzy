class Serverme < Formula
  desc "Open-source tunnel to expose your local servers to the internet"
  homepage "https://serverme.site"
  version "1.0.7"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/jams24/serverme/releases/download/v#{version}/serverme_darwin_arm64.tar.gz"
      sha256 "c4e81007b2561111f80a107b5d0d551ace816203c7d381ed08074f733b21d64d"
    else
      url "https://github.com/jams24/serverme/releases/download/v#{version}/serverme_darwin_amd64.tar.gz"
      sha256 "34deaf969425f62d68d5c18962b0a66424fbf3d1f6781bebafa9c29f309f99f1"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/jams24/serverme/releases/download/v#{version}/serverme_linux_arm64.tar.gz"
      sha256 "29b7827898ffdc58e760e66074a772c874cb95f4a39a35dca806e65699a740c2"
    else
      url "https://github.com/jams24/serverme/releases/download/v#{version}/serverme_linux_amd64.tar.gz"
      sha256 "9e6a88da705c9809f087c3e68e8c01f3f58f867fe69d2079a2dc6deb7da1663d"
    end
  end

  def install
    bin.install "serverme"
  end

  test do
    assert_match "serverme version", shell_output("#{bin}/serverme version")
  end
end
